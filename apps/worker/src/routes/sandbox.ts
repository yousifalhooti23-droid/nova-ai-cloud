import type { SandboxExecRequest, SandboxExecResponse, SandboxStatusResponse } from '@nova/shared';
import type { Hono } from 'hono';
import type { AppEnv } from '../context.js';
import { badRequest, describeError, HttpError } from '../lib/errors.js';
import { classifyCommand } from '../agent/permissions.js';

export function registerSandboxRoutes(app: Hono<AppEnv>) {
  /** What kind of isolation is actually configured. The UI shows this verbatim. */
  app.get('/api/sandbox/status', async (c) => {
    const d = c.get('deps');
    const body: SandboxStatusResponse = d.sandbox.status();
    return c.json(body);
  });

  /**
   * Direct execution from the terminal panel. Same rules as the agent tool:
   * never runs in the API Worker, the same command policy applies, and it
   * returns an explicit error when no sandbox is configured.
   */
  app.post('/api/sandbox/exec', async (c) => {
    const d = c.get('deps');
    const req = (await c.req.json().catch(() => null)) as SandboxExecRequest | null;
    if (!req) throw badRequest('JSON body is required', 'bad_body');
    if (!req.command && !req.code) throw badRequest('provide "command" or "code"', 'missing_input');
    if ((req.command?.length ?? 0) > 4000) throw badRequest('command is too long', 'too_long');
    if ((req.code?.length ?? 0) > 500_000) throw badRequest('code is too large', 'too_large');

    // Defence in depth: the agent's run_command tool already classifies commands,
    // and a direct API call must not get a laxer path to the sandbox.
    if (req.command) {
      const verdict = classifyCommand(req.command);
      if (verdict.risk === 'blocked') {
        throw new HttpError(400, `Command blocked by policy: ${verdict.reason}`, 'command_blocked', `Rule: ${verdict.rule}. The command never reached the sandbox.`);
      }
    }

    let files: Record<string, string> | undefined;
    if (req.projectId) {
      files = {};
      for (const f of await d.store.listFiles(req.projectId)) {
        if (f.sizeBytes > 200_000) continue;
        files[f.path] = f.content;
      }
    }
    try {
      const out: SandboxExecResponse = await d.sandbox.exec({ ...req, files: files ?? req.files });
      return c.json(out);
    } catch (err) {
      // Let HttpError bubble to the shared handler so the client always gets the
      // standard envelope (error + code + hint), including "how do I enable this".
      if (err instanceof HttpError) throw err;
      const { message } = describeError(err);
      throw new HttpError(502, `Sandbox execution failed: ${message}`, 'sandbox_error');
    }
  });
}
