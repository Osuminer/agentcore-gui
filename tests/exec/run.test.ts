import { describe, expect, it } from 'vitest';
import { Run, activeRunForKey, childEnv, execReal, registerRun, runToCompletion, spawnEnv, spawnNodeForTest } from '@/lib/exec/run';

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

describe('spawnEnv', () => {
  it('pins INIT_CWD and PWD to the command cwd so the CLI does not discover the launcher directory', () => {
    const env = spawnEnv({ file: 'agentcore', args: [], cwd: 'C:\proj', env: { INIT_CWD: 'C:\launcher', PWD: '/launcher', KEEP: '1' } });
    expect(env.INIT_CWD).toBe('C:\proj');
    expect(env.PWD).toBe('C:\proj');
    expect(env.KEEP).toBe('1');
  });
  it('does not mutate the spec env', () => {
    const spec = { file: 'agentcore' as const, args: [], cwd: '/p', env: { INIT_CWD: '/launcher' } };
    spawnEnv(spec);
    expect(spec.env.INIT_CWD).toBe('/launcher');
  });
});

describe('redaction across chunk boundaries', () => {
  it('redacts a token that arrives split over two writes', async () => {
    const run = spawnNodeForTest(['-e', "process.stdout.write('Authorization: Bearer abc.de'); setTimeout(()=>process.stdout.write('f-ghi_123\\n'), 150)"]);
    const res = await runToCompletion(run, 10000);
    expect(res.stdout).not.toContain('abc.de');
    expect(res.stdout).not.toContain('f-ghi_123');
    expect(res.stdout).toContain('[redacted]');
  });
  it('flushes a final line that has no trailing newline', async () => {
    const run = spawnNodeForTest(['-e', "process.stdout.write('no newline here')"]);
    expect((await runToCompletion(run, 10000)).stdout).toBe('no newline here');
  });
});

describe('run registry', () => {
  it('reports the active run for a key until it exits', () => {
    const r = new Run('x');
    registerRun(r, 'proj-key');
    expect(activeRunForKey('proj-key')).toBe(r);
    r.push({ type: 'exit', code: 0, signal: null });
    expect(activeRunForKey('proj-key')).toBeUndefined();
  });
  it('returns undefined for an unknown key', () => {
    expect(activeRunForKey('nope')).toBeUndefined();
  });
});

describe('Run event buffer', () => {
  it('caps stored events but keeps the start event', () => {
    const r = new Run('x');
    for (let i = 0; i < 6000; i++) r.push({ type: 'stdout', data: `l${i}\n` });
    expect(r.events.length).toBeLessThanOrEqual(5000);
    expect(r.events[0].type).toBe('start');
    expect(r.events[r.events.length - 1]).toEqual({ type: 'stdout', data: 'l5999\n' });
  });
});
