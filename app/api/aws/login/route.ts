import { findProfile, loginSpec } from '@/lib/aws/identity';
import { childEnv } from '@/lib/exec/run';
import { startExec } from '@/lib/exec';
import { displayCommand } from '@/lib/cli/catalog';
import { handle, json, readJson } from '@/lib/server/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (req: Request) => handle(async () => {
  const b = await readJson(req);
  const prof = await findProfile(String(b.profile ?? ''));
  if (!prof) return json({ error: 'Unknown profile' }, 400);
  const { args } = loginSpec(prof);
  const display = displayCommand('aws', args);
  const run = startExec({ file: 'aws', args, cwd: process.cwd(), env: childEnv(prof.name) }, display);
  return json({ runId: run.id, display });
});
