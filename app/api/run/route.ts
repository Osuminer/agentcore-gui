import { planRun } from '@/lib/server/project';
import { findProfile, getIdentity } from '@/lib/aws/identity';
import { COMMANDS, displayCommand } from '@/lib/cli/catalog';
import { parseStatusOutput } from '@/lib/cli/parsers';
import { activeRunForKey, runToCompletion } from '@/lib/exec/run';
import { deployGate } from '@/lib/server/deploy-gate';
import { startExec } from '@/lib/exec';
import { handle, json, readJson } from '@/lib/server/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (req: Request) => handle(async () => {
  const b = await readJson(req);
  const plan = await planRun(b);

  if (plan.spec.touchesAws) {
    const prof = await findProfile(plan.profile!);
    const ident = await getIdentity(plan.profile!, prof?.region);
    if (!ident.ok) return json({ error: `AWS session check failed: ${ident.message}`, reason: ident.reason }, 401);
    if (plan.spec.id === 'deploy') {
      const c = (b.confirm ?? {}) as { account?: string; region?: string; typedName?: string };
      const region = ident.region ?? prof?.region;
      if (c.account !== ident.account || c.region !== region) {
        return json({ error: 'Deploy requires confirming the target account and region.', account: ident.account, region }, 400);
      }
      // Destructive guard: pending-removal resources require typing the project name.
      const sargs = COMMANDS.status.build({});
      const sres = await runToCompletion(startExec(
        { file: 'agentcore', args: sargs, cwd: plan.exec.cwd, env: plan.exec.env }, displayCommand('agentcore', sargs)), 60_000);
      const projectName = plan.exec.cwd.split(/[\\/]/).pop() ?? '';
      const gate = deployGate(parseStatusOutput(sres.stdout), c.typedName, projectName);
      if (gate.kind === 'needs-typed') return json({ needsTypedName: true, resources: gate.resources, projectName }, 409);
    }
  }
  const busy = activeRunForKey(plan.exec.cwd);
  if (busy) return json({ error: 'A command is already running for this project. Stop it first.', runId: busy.id }, 423);
  const run = startExec(plan.exec, plan.display, plan.exec.cwd);
  return json({ runId: run.id, display: plan.display });
});
