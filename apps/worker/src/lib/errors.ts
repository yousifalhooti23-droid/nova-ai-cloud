import type { ApiError } from '@nova/shared';

/** Error with an HTTP status and a UI-safe message. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public hint?: string,
    public extra?: Partial<ApiError>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
  toJSON(): ApiError {
    return { error: this.message, code: this.code, hint: this.hint, ...this.extra };
  }
}

export const badRequest = (msg: string, code = 'bad_request', hint?: string) => new HttpError(400, msg, code, hint);
export const notFound = (msg: string, code = 'not_found') => new HttpError(404, msg, code);
export const unauthorized = (msg: string, code = 'unauthorized') => new HttpError(401, msg, code);
export const forbidden = (msg: string, code = 'forbidden') => new HttpError(403, msg, code);
export const conflict = (msg: string, code = 'conflict') => new HttpError(409, msg, code);
export const tooLarge = (msg: string, code = 'too_large') => new HttpError(413, msg, code);

/**
 * Raised when no real provider can serve the request.
 * The UI must show this verbatim — we never substitute fake model output.
 */
export class ProviderNotConfiguredError extends HttpError {
  override name = 'ProviderNotConfiguredError';
  constructor(message: string, hint?: string) {
    super(503, message, 'provider_not_configured', hint, { notConfigured: true });
  }
}

export function isProviderNotConfigured(e: unknown): e is ProviderNotConfiguredError {
  return e instanceof ProviderNotConfiguredError || (e as HttpError)?.code === 'provider_not_configured';
}

export function describeError(e: unknown): { message: string; code?: string } {
  if (e instanceof HttpError) return { message: e.message, code: e.code };
  if (e instanceof Error) return { message: e.message, code: e.name };
  return { message: String(e), code: 'unknown' };
}
