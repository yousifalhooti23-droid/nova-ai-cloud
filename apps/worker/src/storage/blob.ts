import type { D1Like } from './d1-store.js';

/**
 * Binary storage abstraction: R2 or D1 (cardless free tier) in production,
 * local filesystem for the Node/Desktop runtime, and memory for tests.
 */
export interface BlobStore {
  readonly kind: 'r2' | 'd1' | 'file' | 'memory';
  put(key: string, data: ArrayBuffer | Uint8Array | string, opts?: { contentType?: string }): Promise<void>;
  get(key: string): Promise<{ data: Uint8Array; contentType?: string; size: number } | null>;
  getText(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

const CHUNK_BYTES = 512 * 1024;

function uint8ToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  }
  return btoa(parts.join(''));
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Cardless Cloudflare Free-Tier Blob Store backed by D1 SQLite (5 GB free, no credit card).
 * Splits payloads into 512 KB chunks so individual statements stay well below D1's 1 MB SQL limit.
 */
export class D1BlobStore implements BlobStore {
  readonly kind = 'd1' as const;
  constructor(private db: D1Like) {}

  async put(key: string, data: ArrayBuffer | Uint8Array | string, opts?: { contentType?: string }) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
    const contentType = opts?.contentType ?? 'application/octet-stream';
    const now = new Date().toISOString();

    await this.db.prepare('DELETE FROM uploaded_blob_chunks WHERE blob_key = ?').bind(key).run();
    const totalChunks = Math.max(1, Math.ceil(bytes.byteLength / CHUNK_BYTES));
    for (let idx = 0; idx < totalChunks; idx++) {
      const slice = bytes.subarray(idx * CHUNK_BYTES, (idx + 1) * CHUNK_BYTES);
      const b64 = uint8ToBase64(slice);
      await this.db
        .prepare(
          `INSERT INTO uploaded_blob_chunks (blob_key, chunk_idx, content_type, total_size, data_b64, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(key, idx, contentType, bytes.byteLength, b64, now)
        .run();
    }
  }

  async get(key: string) {
    const { results } = await this.db
      .prepare('SELECT chunk_idx, content_type, total_size, data_b64 FROM uploaded_blob_chunks WHERE blob_key = ? ORDER BY chunk_idx ASC')
      .bind(key)
      .all<{ chunk_idx: number; content_type: string; total_size: number; data_b64: string }>();
    if (!results.length) return null;
    const chunks = results.map((r) => base64ToUint8(r.data_b64));
    const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return { data: merged, contentType: results[0].content_type, size: merged.byteLength };
  }

  async getText(key: string) {
    const obj = await this.get(key);
    return obj ? new TextDecoder().decode(obj.data) : null;
  }

  async delete(key: string) {
    await this.db.prepare('DELETE FROM uploaded_blob_chunks WHERE blob_key = ?').bind(key).run();
  }
}

interface R2Like {
  put(key: string, value: ArrayBuffer | Uint8Array | string | ReadableStream, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string }; size: number } | null>;
  delete(key: string): Promise<void>;
}

export class R2BlobStore implements BlobStore {
  readonly kind = 'r2' as const;
  constructor(private bucket: R2Like) {}
  async put(key: string, data: ArrayBuffer | Uint8Array | string, opts?: { contentType?: string }) {
    await this.bucket.put(key, data as ArrayBuffer, { httpMetadata: { contentType: opts?.contentType ?? 'application/octet-stream' } });
  }
  async get(key: string) {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    const buf = await obj.arrayBuffer();
    return { data: new Uint8Array(buf), contentType: obj.httpMetadata?.contentType, size: obj.size };
  }
  async getText(key: string) {
    const obj = await this.get(key);
    return obj ? new TextDecoder().decode(obj.data) : null;
  }
  async delete(key: string) {
    await this.bucket.delete(key);
  }
}

export class MemoryBlobStore implements BlobStore {
  readonly kind = 'memory' as const;
  private map = new Map<string, { data: Uint8Array; contentType?: string }>();
  async put(key: string, data: ArrayBuffer | Uint8Array | string, opts?: { contentType?: string }) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
    this.map.set(key, { data: bytes, contentType: opts?.contentType });
  }
  async get(key: string) {
    const hit = this.map.get(key);
    return hit ? { data: hit.data, contentType: hit.contentType, size: hit.data.byteLength } : null;
  }
  async getText(key: string) {
    const hit = await this.get(key);
    return hit ? new TextDecoder().decode(hit.data) : null;
  }
  async delete(key: string) {
    this.map.delete(key);
  }
}

export class FileBlobStore implements BlobStore {
  readonly kind = 'file' as const;
  private fs: typeof import('node:fs') | null = null;
  private path: typeof import('node:path') | null = null;
  constructor(private dir: string) {}
  private async load() {
    if (!this.fs) {
      this.fs = await import('node:fs');
      this.path = await import('node:path');
      this.fs.mkdirSync(this.dir, { recursive: true });
    }
    return { fs: this.fs!, path: this.path! };
  }
  private resolve(key: string) {
    const p = this.path!.join(this.dir, key.replace(/^\/+/, ''));
    if (!p.startsWith(this.dir)) throw new Error('blob key escapes storage root');
    return p;
  }
  async put(key: string, data: ArrayBuffer | Uint8Array | string, opts?: { contentType?: string }) {
    const { fs, path } = await this.load();
    const target = this.resolve(key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
    fs.writeFileSync(target, bytes);
    if (opts?.contentType) fs.writeFileSync(`${target}.meta`, JSON.stringify({ contentType: opts.contentType }));
  }
  async get(key: string) {
    const { fs } = await this.load();
    const target = this.resolve(key);
    if (!fs.existsSync(target)) return null;
    const data = new Uint8Array(fs.readFileSync(target));
    let contentType: string | undefined;
    try { contentType = (JSON.parse(fs.readFileSync(`${target}.meta`, 'utf8')) as { contentType?: string }).contentType; } catch { /* ignore */ }
    return { data, contentType, size: data.byteLength };
  }
  async getText(key: string) {
    const obj = await this.get(key);
    return obj ? new TextDecoder().decode(obj.data) : null;
  }
  async delete(key: string) {
    const { fs } = await this.load();
    const target = this.resolve(key);
    if (fs.existsSync(target)) fs.unlinkSync(target);
    if (fs.existsSync(`${target}.meta`)) fs.unlinkSync(`${target}.meta`);
  }
}
