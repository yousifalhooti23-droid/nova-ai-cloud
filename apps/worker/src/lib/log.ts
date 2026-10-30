export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Structured logger. On Cloudflare Workers these lines land in `wrangler tail`
 * / the observability dashboard; under Node they go to stdout as JSON.
 * Secrets are never logged — callers pass safe fields only.
 */
export function createLogger(scope: string, level: LogLevel = 'info') {
  const enabled = (l: LogLevel) => ORDER[l] >= ORDER[level];
  const emit = (l: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (!enabled(l)) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level: l, scope, msg, ...fields });
    if (l === 'error') console.error(line);
    else if (l === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
    info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
    warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
    error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
    child: (childScope: string) => createLogger(`${scope}:${childScope}`, level),
  };
}
export type Logger = ReturnType<typeof createLogger>;
