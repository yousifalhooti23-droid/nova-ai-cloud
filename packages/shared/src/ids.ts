/** Id helpers that work in both workerd and Node 20+. */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomBytes(length: number): Uint8Array {
  const g = globalThis as { crypto?: Crypto };
  if (g.crypto?.getRandomValues) {
    const out = new Uint8Array(length);
    g.crypto.getRandomValues(out);
    return out;
  }
  // Extremely defensive fallback; workerd and Node 20 both have webcrypto.
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** Short, sortable-ish id: `pfx_` + 16 base36 chars. */
export function newId(prefix: string): string {
  const bytes = randomBytes(16);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${s}`;
}

export function uuid(): string {
  const g = globalThis as { crypto?: Crypto };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return newId('id');
}

/** FNV-1a 32-bit hash — stable across runtimes, used for file blob shas. */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export async function sha256Hex(input: string): Promise<string> {
  const g = globalThis as { crypto?: Crypto & { subtle?: SubtleCrypto } };
  if (g.crypto?.subtle) {
    const buf = await g.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return shortHash(input);
}

export function nowIso(): string {
  return new Date().toISOString();
}
