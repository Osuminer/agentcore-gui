import { describe, expect, it } from 'vitest';
import { Run, childEnv, execReal, runToCompletion, spawnNodeForTest } from '@/lib/exec/run';

describe('Run', () => {
  it('replays buffered events to late subscribers, then streams', () => {
    const r = new Run('cmd');
    r.push({ type: 'stdout', data: 'a' });
    const seen: string[] = [];
    r.subscribe((e) => seen.push(e.type));
    r.push({ type: 'exit', code: 0, signal: null });
    expect(seen).toEqual(['start', 'stdout', 'exit']);
    expect(r.done).toBe(true);
  });
  it('stops notifying after unsubscribe', () => {
    const r = new Run('cmd');
    const seen: string[] = [];
    const off = r.subscribe((e) => seen.push(e.type));
    off();
    r.push({ type: 'stdout', data: 'x' });
    expect(seen).toEqual(['start']);
  });
});

describe('childEnv', () => {
  it('sets AWS_PROFILE and strips other AWS_ credentials', () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIAXXXXXXXXXXXXXXXX';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    process.env.AWS_SESSION_TOKEN = 'tok';
    const env = childEnv('myprof');
    expect(env.AWS_PROFILE).toBe('myprof');
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.AWS_SESSION_TOKEN).toBeUndefined();
    expect(env.NO_COLOR).toBe('1');
    delete process.env.AWS_ACCESS_KEY_ID; delete process.env.AWS_SECRET_ACCESS_KEY; delete process.env.AWS_SESSION_TOKEN;
  });
  it('omits AWS_PROFILE when no profile is given', () => {
    expect(childEnv().AWS_PROFILE).toBeUndefined();
  });
  it('keeps AWS_CONFIG_FILE / AWS_SHARED_CREDENTIALS_FILE locations', () => {
    process.env.AWS_CONFIG_FILE = '/x';
    expect(childEnv('p').AWS_CONFIG_FILE).toBe('/x');
    delete process.env.AWS_CONFIG_FILE;
  });
});

describe('execReal', () => {
  it('reports a missing binary as an error event followed by exit', async () => {
    const run = execReal({ file: 'agentcore', args: [], cwd: process.cwd(), env: { PATH: '' } }, 'agentcore');
    const res = await runToCompletion(run, 5000);
    expect(res.error).toMatch(/not found/i);
    expect(run.done).toBe(true);
  });
});

describe('spawn plumbing', () => {
  it('streams stdout/stderr, redacts, and reports exit code', async () => {
    const run = spawnNodeForTest(['-e', "console.log('hi Bearer abc.def'); console.error('oops'); process.exit(3)"]);
    const res = await runToCompletion(run, 10000);
    expect(res.code).toBe(3);
    expect(res.stdout).toContain('hi Bearer [redacted]');
    expect(res.stderr).toContain('oops');
  });
  it('cancel terminates a long-running process', async () => {
    const run = spawnNodeForTest(['-e', 'setInterval(()=>{},1000)']);
    setTimeout(() => run.cancel(), 300);
    const res = await runToCompletion(run, 10000);
    expect(run.done).toBe(true);
    expect(res.code === 0).toBe(false);
  });
});
