import { planRun } from '@/lib/server/project';
import { findProfile, getIdentity } from '@/lib/aws/identity';
import { COMMANDS, isCommandId } from '@/lib/cli/catalog';
import { handle, json, readJson } from '@/lib/server/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (req: Request) => handle(async () => {
  const b = await readJson(req);
  let plan;
  try {
    plan = await planRun(b);
  } catch (e) {
    // Let the dialog render its fields even while required params are missing.
    if (!isCommandId(b.commandId)) throw e;
    const spec = COMMANDS[b.commandId];
    return json({
      display: '(fill in the fields)', label: spec.label, description: spec.description,
      touchesAws: spec.touchesAws, longRunning: spec.longRunning, fields: spec.fields, problem: (e as Error).message,
    });
  }
  const identity = plan.spec.touchesAws && plan.profile
    ? await getIdentity(plan.profile, (await findProfile(plan.profile))?.region)
    : undefined;
  return json({
    display: plan.display, label: plan.spec.label, description: plan.spec.description,
    touchesAws: plan.spec.touchesAws, longRunning: plan.spec.longRunning, fields: plan.spec.fields, identity,
  });
});
