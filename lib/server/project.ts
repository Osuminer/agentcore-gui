import fs from 'node:fs/promises';
import { loadProject } from '@/lib/config/load';
import { applyStatus } from '@/lib/config/status';
import type { Graph } from '@/lib/config/types';
import { resolveProjectRoot } from '@/lib/fs/safe-read';
import { COMMANDS, displayCommand, isCommandId, validateParams, type CommandSpec } from '@/lib/cli/catalog';
import { parseStatusOutput, parseValidateOutput } from '@/lib/cli/parsers';
import { PROFILE_NAME_RE } from '@/lib/aws/config';
import { getIdentity } from '@/lib/aws/identity';
import { resolveBinary } from '@/lib/exec/binary';
import { childEnv, execReal, runToCompletion, type ExecSpec } from '@/lib/exec/run';
import { startExec, isMock } from '@/lib/exec';

export interface PrereqInfo { found: boolean; version?: string }
export interface RunPlan { spec: CommandSpec; params: Record<string, string>; exec: ExecSpec; display: string; projectRoot?: string; profile?: string }

export async function planRun(body: Record<string, unknown>): Promise<RunPlan> {
  const id = body.commandId;
  if (!isCommandId(id)) throw new Error(`Unknown command: ${String(id)}`);
  const spec = COMMANDS[id];
  const params = validateParams(spec, body.params);
  const profile = typeof body.profile === 'string' && body.profile ? body.profile : undefined;
  if (profile && !PROFILE_NAME_RE.test(profile)) throw new Error('Invalid profile name');
  if (spec.touchesAws && !profile) throw new Error('An AWS profile is required for this command');

  let cwd: string;
  let projectRoot: string | undefined;
  if (spec.cwd === 'project') {
    projectRoot = await resolveProjectRoot(String(body.projectPath ?? ''));
    cwd = projectRoot;
  } else {
    const dir = params.outputDir;
    const st = await fs.stat(dir);
    if (!st.isDirectory()) throw new Error(`Not a directory: ${dir}`);
    cwd = await fs.realpath(dir);
  }
  const args = spec.build(params);
  return {
    spec, params, projectRoot, profile,
    exec: { file: spec.tool, args, cwd, env: childEnv(profile) },
    display: displayCommand(spec.tool, args),
  };
}

export async function buildProjectGraph(projectPath: string, profile?: string):
  Promise<{ graph: Graph; status: 'ok' | 'skipped' | 'failed'; note?: string }> {
  const root = await resolveProjectRoot(projectPath);
  const graph = await loadProject(root);

  const run = (id: 'validate' | 'status') => {
    const args = COMMANDS[id].build({});
    return runToCompletion(startExec({ file: 'agentcore', args, cwd: root, env: childEnv(profile) }, displayCommand('agentcore', args)), 60_000);
  };

  const v = await run('validate');
  const validate = parseValidateOutput(v.stdout, v.code);

  let status: ReturnType<typeof parseStatusOutput> | null = null;
  let note: string | undefined;
  let outcome: 'ok' | 'skipped' | 'failed' = 'skipped';
  if (!profile) {
    note = 'Select an AWS profile and log in to load deployment status.';
  } else {
    const ident = await getIdentity(profile);
    if (!ident.ok) {
      note = `Deployment status unavailable: ${ident.message}`;
    } else {
      const s = await run('status');
      status = parseStatusOutput(s.stdout);
      if (status.ok) outcome = 'ok';
      else { outcome = 'failed'; note = `Status failed: ${status.error}`; }
    }
  }
  return { graph: applyStatus(graph, status && status.ok ? status.resources : null, validate), status: outcome, note };
}

async function version(cmd: 'agentcore' | 'aws' | 'uv'): Promise<PrereqInfo> {
  if (isMock()) return { found: true, version: 'mock' };
  try { resolveBinary(cmd); } catch { return { found: false }; }
  const res = await runToCompletion(execReal({ file: cmd, args: ['--version'], cwd: process.cwd(), env: childEnv() }, `${cmd} --version`), 20_000);
  return res.code === 0 ? { found: true, version: (res.stdout || res.stderr).trim().split('\n')[0] } : { found: false };
}

export async function detectPrereqs() {
  const [agentcore, aws, uv] = await Promise.all([version('agentcore'), version('aws'), version('uv')]);
  return { agentcore, aws, uv };
}
