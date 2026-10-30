/**
 * Tiny dependency-free validator. Enough for our DTOs, keeps the Worker bundle
 * small, and produces error messages that are safe to show in the UI.
 */

export class ValidationError extends Error {
  override name = 'ValidationError';
  constructor(public field: string, message: string) {
    super(`${field}: ${message}`);
  }
}

export type Validator<T> = (value: unknown, field: string) => T;

export const v = {
  string(opts: { min?: number; max?: number; optional?: boolean; trim?: boolean } = {}): Validator<string | undefined> {
    return (value, field) => {
      if (value === undefined || value === null || value === '') {
        if (opts.optional) return undefined;
        throw new ValidationError(field, 'is required');
      }
      if (typeof value !== 'string') throw new ValidationError(field, 'must be a string');
      const out = opts.trim === false ? value : value.trim();
      if (opts.min !== undefined && out.length < opts.min) throw new ValidationError(field, `must be at least ${opts.min} characters`);
      if (opts.max !== undefined && out.length > opts.max) throw new ValidationError(field, `must be at most ${opts.max} characters`);
      return out;
    };
  },
  number(opts: { min?: number; max?: number; optional?: boolean; fallback?: number } = {}): Validator<number | undefined> {
    return (value, field) => {
      if (value === undefined || value === null || value === '') {
        if (opts.optional) return opts.fallback;
        throw new ValidationError(field, 'is required');
      }
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) throw new ValidationError(field, 'must be a number');
      if (opts.min !== undefined && n < opts.min) throw new ValidationError(field, `must be >= ${opts.min}`);
      if (opts.max !== undefined && n > opts.max) throw new ValidationError(field, `must be <= ${opts.max}`);
      return n;
    };
  },
  boolean(opts: { fallback?: boolean } = {}): Validator<boolean> {
    return (value, field) => {
      if (value === undefined || value === null) return opts.fallback ?? false;
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new ValidationError(field, 'must be a boolean');
    };
  },
  enum<T extends string>(allowed: readonly T[], opts: { optional?: boolean; fallback?: T } = {}): Validator<T | undefined> {
    return (value, field) => {
      if (value === undefined || value === null || value === '') {
        if (opts.optional) return opts.fallback;
        throw new ValidationError(field, 'is required');
      }
      if (typeof value !== 'string' || !allowed.includes(value as T)) {
        throw new ValidationError(field, `must be one of: ${allowed.join(', ')}`);
      }
      return value as T;
    };
  },
  object<T extends Record<string, unknown>>(shape: { [K in keyof T]: Validator<T[K]> }): Validator<T> {
    return (value, field) => {
      if (typeof value !== 'object' || value === null) throw new ValidationError(field, 'must be an object');
      const src = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(shape)) {
        out[key] = shape[key as keyof T](src[key], field ? `${field}.${key}` : key);
      }
      return out as T;
    };
  },
  arrayOf<T>(inner: Validator<T>, opts: { max?: number } = {}): Validator<T[]> {
    return (value, field) => {
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value)) throw new ValidationError(field, 'must be an array');
      if (opts.max !== undefined && value.length > opts.max) throw new ValidationError(field, `must have at most ${opts.max} items`);
      return value.map((item, i) => inner(item, `${field}[${i}]`));
    };
  },
  record(inner: Validator<unknown>): Validator<Record<string, unknown>> {
    return (value, field) => {
      if (value === undefined || value === null) return {};
      if (typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(field, 'must be an object');
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(value as Record<string, unknown>)) out[k] = inner(val, `${field}.${k}`);
      return out;
    };
  },
};

export function parseWith<T>(validator: Validator<T>, value: unknown, field = 'body'): T {
  return validator(value, field) as T;
}
