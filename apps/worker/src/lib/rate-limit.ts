/**
 * In-memory sliding-window IP rate limiter to protect Cloudflare and OpenRouter free quotas.
 * Limits unauthenticated / abusive requests (e.g. max 25 requests per minute per IP).
 */
export class IpRateLimiter {
  private windowMs: number;
  private maxRequests: number;
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(windowMs = 60_000, maxRequests = 25) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  isLimited(ip: string): { limited: boolean; remaining: number; resetInSec: number } {
    const now = Date.now();
    // Prune stale entries if map gets too large
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits.entries()) {
        if (v.resetAt < now) this.hits.delete(k);
      }
    }

    const record = this.hits.get(ip);
    if (!record || record.resetAt < now) {
      this.hits.set(ip, { count: 1, resetAt: now + this.windowMs });
      return { limited: false, remaining: this.maxRequests - 1, resetInSec: Math.ceil(this.windowMs / 1000) };
    }

    record.count++;
    if (record.count > this.maxRequests) {
      return { limited: true, remaining: 0, resetInSec: Math.max(1, Math.ceil((record.resetAt - now) / 1000)) };
    }

    return { limited: false, remaining: this.maxRequests - record.count, resetInSec: Math.max(1, Math.ceil((record.resetAt - now) / 1000)) };
  }
}

export const globalIpRateLimiter = new IpRateLimiter(60_000, 25);
