/**
 * Binary storage abstraction: R2 in production, local filesystem for the Node
 * dev runtime, and a memory bucket for tests. Same interface everywhere.
 */
export interface BlobStore {
  readonly kind: 'r2' | 'file' | 'memory';
  put(key: string, data: ArrayBuffer | Uint8Array | string, opts?: { contentType?: string }): Promise<void>;
  get(key: string): Promise<{ data: Uint8Array; contentType?: string; size: number } | null>;
  getText(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
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
