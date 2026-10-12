import fs from 'node:fs';
import path from 'node:path';
import { Run, type ExecSpec } from './run';

export const isMock = () => process.env.MOCK === '1';

const g = globalThis as unknown as { __acMockLoggedIn?: boolean };
export const mockSession = {
  get loggedIn() { return g.__acMockLoggedIn === true; },
  set loggedIn(v: boolean) { g.__acMockLoggedIn = v; },
};

function script(run: Run, lines: { t: number; s: 'stdout' | 'stderr'; d: string }[], code = 0, onDone?: () => void) {
  const timers: NodeJS.Timeout[] = [];
  lines.forEach((l) => timers.push(setTimeout(() => run.push({ type: l.s, data: l.d + '\n' }), l.t)));
  const last = Math.max(0, ...lines.map((l) => l.t)) + 150;
  timers.push(setTimeout(() => { onDone?.(); run.push({ type: 'exit', code, signal: null }); }, last));
  run.setCancelHook(() => { timers.forEach(clearTimeout); run.push({ type: 'exit', code: null, signal: 'SIGTERM' }); });
}

function mockStatus(cwd: string): string {
  const resources: unknown[] = [];
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(cwd, 'agentcore', 'agentcore.json'), 'utf8'));
    (doc.runtimes ?? []).forEach((r: { name: string }, i: number) => resources.push({ resourceType: 'agent', name: r.name, deploymentState: i === 0 ? 'deployed' : 'local-only' }));
    (doc.memories ?? []).forEach((m: { name: string }) => resources.push({ resourceType: 'memory', name: m.name, deploymentState: 'local-only' }));
    (doc.agentCoreGateways ?? []).forEach((gw: { name: string; targets?: unknown[] }) =>
      resources.push({ resourceType: 'gateway', name: gw.name, deploymentState: 'deployed', detail: `${gw.targets?.length ?? 0} targets` }));
  } catch { /* fall through with no resources */ }
  return JSON.stringify({ success: true, projectName: 'demo', targetName: 'default', resources });
}

export function execMock(spec: ExecSpec, display: string): Run {
  const run = new Run(display);
  const [a0, a1] = spec.args;
  if (spec.file === 'aws' && a0 === 'sso') {
    script(run, [
      { t: 100, s: 'stdout', d: 'Attempting to automatically open the SSO authorization page in your default browser.' },
      { t: 200, s: 'stdout', d: 'Browser will not be automatically opened.' },
      { t: 300, s: 'stdout', d: 'Open the following URL:' },
      { t: 350, s: 'stdout', d: 'https://device.sso.us-east-1.amazonaws.com/' },
      { t: 400, s: 'stdout', d: 'and enter the code: ABCD-EFGH' },
      { t: 2500, s: 'stdout', d: 'Successfully logged into Start URL: https://mock.awsapps.com/start' },
    ], 0, () => { mockSession.loggedIn = true; });
  } else if (spec.file === 'aws') {
    script(run, [{ t: 50, s: 'stdout', d: '{}' }]);
  } else if (a0 === 'status') {
    script(run, [{ t: 150, s: 'stdout', d: mockStatus(spec.cwd) }]);
  } else if (a0 === 'validate') {
    script(run, [{ t: 100, s: 'stdout', d: '{"success":true}' }]);
  } else if (a0 === 'deploy') {
    script(run, [
      { t: 200, s: 'stdout', d: 'Synthesizing CDK app...' }, { t: 900, s: 'stdout', d: 'orders_agent: CREATE_IN_PROGRESS' },
      { t: 1800, s: 'stdout', d: 'orders_agent: CREATE_COMPLETE' }, { t: 2200, s: 'stdout', d: '{"success":true}' },
    ]);
  } else if (a0 === 'dev') {
    let n = 0;
    const iv = setInterval(() => run.push({ type: 'stdout', data: `[dev] heartbeat ${++n}\n` }), 1000);
    run.setCancelHook(() => { clearInterval(iv); run.push({ type: 'exit', code: null, signal: 'SIGTERM' }); });
  } else if (a0 === 'create') {
    script(run, [{ t: 200, s: 'stdout', d: spec.args.includes('--dry-run') ? 'Would create project (dry run)' : '{"success":true,"mock":true}' }]);
  } else {
    script(run, [{ t: 150, s: 'stdout', d: `(mock) ${a0} ${a1 ?? ''} completed` }]);
  }
  return run;
}
