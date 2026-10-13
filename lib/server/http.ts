import { PathEscapeError } from '@/lib/fs/safe-read';
import { ParamError } from '@/lib/cli/catalog';

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch { return {}; }
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try { return await fn(); } catch (e) {
    if (e instanceof PathEscapeError) return json({ error: e.message }, 400);
    if (e instanceof ParamError) return json({ error: e.message }, 400);
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return json({ error: `Path not found: ${err.message}` }, 404);
    const msg = err.message ?? 'Internal error';
    return json({ error: msg }, /Not an AgentCore project|Unknown command|profile|Invalid|Not a directory/i.test(msg) ? 400 : 500);
  }
}
