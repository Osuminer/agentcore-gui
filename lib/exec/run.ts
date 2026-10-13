import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolveBinary, type Env } from './binary';
import { redact } from './redact';

export type RunEvent =
  | { type: 'start'; command: string }
  | { type: 'stdout' | 'stderr'; data: string }
  | { type: 'error'; message: string }
  | { type: 'exit'; code: number | null; signal: string | null };

export interface ExecSpec { file: 'agentcore' | 'aws' | 'uv'; args: string[]; cwd: string; env: Env }

export class Run {
  id = randomUUID();
  events: RunEvent[] = [];
  done = false;
  child?: ChildProcess;
  private listeners = new Set<(e: RunEvent) => void>();
  private cancelHook?: () => void;

  constructor(public command: string) { this.events.push({ type: 'start', command }); }

  setCancelHook(fn: () => void) { this.cancelHook = fn; }

  push(e: RunEvent) {
    if (this.done) return;
    this.events.push(e);
    if (e.type === 'exit') this.done = true;
    for (const l of this.listeners) l(e);
  }

  subscribe(fn: (e: RunEvent) => void): () => void {
    for (const e of this.events) fn(e);
    if (this.done) return () => {};
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  cancel() {
    if (this.done) return;
    if (this.cancelHook) this.cancelHook();
    else this.child?.kill();
  }
}

const g = globalThis as unknown as { __acRuns?: Map<string, Run> };
const runs = (g.__acRuns ??= new Map<string, Run>());

export function registerRun(run: Run) {
  runs.set(run.id, run);
  setTimeout(() => runs.delete(run.id), 30 * 60 * 1000).unref?.();
}
export function getRun(id: string) { return runs.get(id); }

export function childEnv(profile?: string, extra: Env = {}): Env {
  const env: Env = {};
  const KEEP = new Set(['AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE', 'AWS_EC2_METADATA_DISABLED']);
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.toUpperCase().startsWith('AWS_') && !KEEP.has(k.toUpperCase())) continue;
    env[k] = v;
  }
  env.NO_COLOR = '1';
  env.FORCE_COLOR = '0';
  if (profile) env.AWS_PROFILE = profile;
  return { ...env, ...extra };
}

function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false });
  else child.kill('SIGTERM');
}

function attach(run: Run, child: ChildProcess) {
  run.child = child;
  run.setCancelHook(() => killTree(child));
  child.stdout?.on('data', (d: Buffer) => run.push({ type: 'stdout', data: redact(d.toString()) }));
  child.stderr?.on('data', (d: Buffer) => run.push({ type: 'stderr', data: redact(d.toString()) }));
  child.on('error', (err: NodeJS.ErrnoException) => {
    run.push({ type: 'error', message: err.code === 'ENOENT' ? `Executable not found: ${err.message}` : err.message });
    run.push({ type: 'exit', code: null, signal: null });
  });
  child.on('close', (code, signal) => run.push({ type: 'exit', code, signal }));
}

/**
 * The AgentCore CLI discovers its project from INIT_CWD (set by npm/npx for whatever directory
 * launched this server) before process.cwd(). Pin both so commands always run against `spec.cwd`.
 */
export function spawnEnv(spec: ExecSpec): Env {
  return { ...spec.env, INIT_CWD: spec.cwd, PWD: spec.cwd };
}

export function execReal(spec: ExecSpec, display: string): Run {
  const run = new Run(display);
  let resolved: { file: string; prefixArgs: string[] };
  try {
    resolved = resolveBinary(spec.file, spec.env);
  } catch (e) {
    queueMicrotask(() => {
      run.push({ type: 'error', message: `${(e as Error).message} (is the ${spec.file} CLI installed and on PATH?)` });
      run.push({ type: 'exit', code: null, signal: null });
    });
    return run;
  }
  const child = spawn(resolved.file, [...resolved.prefixArgs, ...spec.args], {
    cwd: spec.cwd, env: spawnEnv(spec) as NodeJS.ProcessEnv, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  attach(run, child);
  return run;
}

/** Test helper: spawn this Node binary directly with the same plumbing as execReal. */
export function spawnNodeForTest(args: string[]): Run {
  const run = new Run(`node ${args.join(' ')}`);
  attach(run, spawn(process.execPath, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }));
  return run;
}

export function runToCompletion(run: Run, timeoutMs = 60_000): Promise<{ code: number | null; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    let stdout = '', stderr = '', error: string | undefined;
    let timer: NodeJS.Timeout | undefined;
    let off: () => void = () => {};
    let finished = false;
    off = run.subscribe((e) => {
      if (e.type === 'stdout') stdout += e.data;
      else if (e.type === 'stderr') stderr += e.data;
      else if (e.type === 'error') error = e.message;
      else if (e.type === 'exit' && !finished) {
        finished = true;
        if (timer) clearTimeout(timer);
        queueMicrotask(() => off());
        resolve({ code: e.code, stdout, stderr, error });
      }
    });
    if (!run.done) {
      timer = setTimeout(() => { error = `Timed out after ${timeoutMs}ms`; run.cancel(); }, timeoutMs);
    }
  });
}
