/**
 * Cryptographic primitives built strictly on the standard Web Crypto API (`crypto.subtle`)
 * so identical security guarantees hold in Cloudflare Workers (`workerd`) AND Node/Desktop.
 */

const PBKDF2_ITERATIONS = 100_000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) {
    return new Uint8Array(0);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Constant-time string / byte comparison to prevent timing side-channels. */
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ba.length, bb.length, 1);
  let diff = ba.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export function randomHex(byteLength = 32): string {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

export function generateSessionToken(): string {
  return `nvs_${randomHex(32)}`;
}

export async function sha256HexToken(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(digest));
}

export async function hashPassword(password: string, existingSaltHex?: string): Promise<{ hashHex: string; saltHex: string }> {
  const saltHex = existingSaltHex ?? randomHex(SALT_BYTES);
  const salt = hexToBytes(saltHex);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_BYTES * 8,
  );
  return { hashHex: bytesToHex(new Uint8Array(bits)), saltHex };
}

export async function verifyPassword(password: string, expectedHashHex: string, saltHex: string): Promise<boolean> {
  if (!expectedHashHex || !saltHex) return false;
  const { hashHex } = await hashPassword(password, saltHex);
  return constantTimeEqual(hashHex, expectedHashHex);
}
