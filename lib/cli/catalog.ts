import type { GraphNode } from '@/lib/config/types';

export type CommandId = 'validate' | 'status' | 'package' | 'deploy' | 'deployDiff' | 'deployDryRun'
  | 'invoke' | 'invokeHarness' | 'dev' | 'logs' | 'tracesList' | 'create' | 'createDryRun';

export interface FieldDef { key: string; label: string; required: boolean; kind: 'name' | 'text' | 'path' | 'enum'; options?: string[] }

export interface CommandSpec {
  id: CommandId;
  label: string;
  description: string;
  tool: 'agentcore';
  touchesAws: boolean;
  longRunning: boolean;
  cwd: 'project' | 'outputDir';
  fields: FieldDef[];
  build(p: Record<string, string>): string[];
}

export class ParamError extends Error {
  constructor(message: string) { super(message); this.name = 'ParamError'; }
}

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
const SINCE = ['15m', '1h', '6h', '1d', '7d'];
const FRAMEWORKS = ['Strands', 'LangChain_LangGraph', 'GoogleADK', 'OpenAIAgents', 'VercelAI'];
const PROVIDERS = ['Bedrock', 'Anthropic', 'OpenAI', 'Gemini'];

const runtimeField: FieldDef = { key: 'runtime', label: 'Runtime', required: false, kind: 'name' };
const opt = (p: Record<string, string>, flag: string, key: string): string[] => (p[key] ? [flag, p[key]] : []);

const createFields: FieldDef[] = [
  { key: 'projectName', label: 'Project name', required: true, kind: 'name' },
  { key: 'agentName', label: 'Agent name', required: true, kind: 'name' },
  { key: 'framework', label: 'Framework', required: true, kind: 'enum', options: FRAMEWORKS },
  { key: 'modelProvider', label: 'Model provider', required: true, kind: 'enum', options: PROVIDERS },
  { key: 'outputDir', label: 'Output directory', required: true, kind: 'path' },
];
const createArgv = (p: Record<string, string>, dry: boolean): string[] => [
  'create', '--project-name', p.projectName, '--name', p.agentName, '--language', 'TypeScript',
  '--framework', p.framework, '--model-provider', p.modelProvider, '--memory', 'none',
  '--skip-git', '--skip-install', '--output-dir', p.outputDir, ...(dry ? ['--dry-run'] : []), '--json',
];

export const COMMANDS: Record<CommandId, CommandSpec> = {
  validate: { id: 'validate', label: 'Validate config', description: 'Check agentcore/ config files', tool: 'agentcore', touchesAws: false, longRunning: false, cwd: 'project', fields: [], build: () => ['validate', '--json'] },
  status: { id: 'status', label: 'Refresh status', description: 'Show deployed resource status', tool: 'agentcore', touchesAws: true, longRunning: false, cwd: 'project', fields: [], build: () => ['status', '--json'] },
  package: { id: 'package', label: 'Package', description: 'Package agent artifacts without deploying', tool: 'agentcore', touchesAws: false, longRunning: false, cwd: 'project', fields: [runtimeField], build: (p) => ['package', ...opt(p, '--runtime', 'runtime')] },
  deploy: { id: 'deploy', label: 'Deploy', description: 'Deploy project infrastructure to AWS via CDK', tool: 'agentcore', touchesAws: true, longRunning: true, cwd: 'project', fields: [], build: () => ['deploy', '--yes', '--json', '-v'] },
  deployDiff: { id: 'deployDiff', label: 'Deploy (diff only)', description: 'Show the CDK diff without deploying', tool: 'agentcore', touchesAws: true, longRunning: false, cwd: 'project', fields: [], build: () => ['deploy', '--diff', '--json'] },
  deployDryRun: { id: 'deployDryRun', label: 'Deploy (dry run)', description: 'Preview deployment without deploying', tool: 'agentcore', touchesAws: true, longRunning: false, cwd: 'project', fields: [], build: () => ['deploy', '--dry-run', '--json'] },
  invoke: { id: 'invoke', label: 'Invoke', description: 'Invoke a deployed agent', tool: 'agentcore', touchesAws: true, longRunning: false, cwd: 'project',
    fields: [{ key: 'prompt', label: 'Prompt', required: true, kind: 'text' }, runtimeField],
    build: (p) => ['invoke', `--prompt=${p.prompt}`, '--stream', ...opt(p, '--runtime', 'runtime')] },
  invokeHarness: { id: 'invokeHarness', label: 'Invoke harness', description: 'Invoke a deployed harness', tool: 'agentcore', touchesAws: true, longRunning: false, cwd: 'project',
    fields: [{ key: 'prompt', label: 'Prompt', required: true, kind: 'text' }, { key: 'harness', label: 'Harness', required: true, kind: 'name' }],
    build: (p) => ['invoke', `--prompt=${p.prompt}`, '--stream', '--harness', p.harness] },
  dev: { id: 'dev', label: 'Run locally (dev)', description: 'Local dev server with logs (skips auto-deploy)', tool: 'agentcore', touchesAws: false, longRunning: true, cwd: 'project', fields: [runtimeField], build: (p) => ['dev', '--logs', '--skip-deploy', ...opt(p, '--runtime', 'runtime')] },
  logs: { id: 'logs', label: 'Search logs', description: 'Search recent runtime logs', tool: 'agentcore', touchesAws: true, longRunning: false, cwd: 'project',
    fields: [runtimeField, { key: 'since', label: 'Since', required: false, kind: 'enum', options: SINCE }],
    build: (p) => ['logs', '--json', '--since', p.since || '1h', '--limit', '200', ...opt(p, '--runtime', 'runtime')] },
  tracesList: { id: 'tracesList', label: 'List traces', description: 'List recent traces for a runtime', tool: 'agentcore', touchesAws: true, longRunning: false, cwd: 'project', fields: [runtimeField], build: (p) => ['traces', 'list', '--json', ...opt(p, '--runtime', 'runtime')] },
  create: { id: 'create', label: 'Create project', description: 'Scaffold a new AgentCore project (TypeScript)', tool: 'agentcore', touchesAws: false, longRunning: false, cwd: 'outputDir', fields: createFields, build: (p) => createArgv(p, false) },
  createDryRun: { id: 'createDryRun', label: 'Create project (dry run)', description: 'Preview what create would do', tool: 'agentcore', touchesAws: false, longRunning: false, cwd: 'outputDir', fields: createFields, build: (p) => createArgv(p, true) },
};

export function isCommandId(v: unknown): v is CommandId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(COMMANDS, v);
}

export function validateParams(spec: CommandSpec, params: unknown): Record<string, string> {
  if (params === undefined) params = {};
  if (typeof params !== 'object' || params === null || Array.isArray(params)) throw new ParamError('params must be an object');
  const input = params as Record<string, unknown>;
  const known = new Set(spec.fields.map((f) => f.key));
  for (const k of Object.keys(input)) if (!known.has(k)) throw new ParamError(`Unknown parameter '${k}'`);
  const out: Record<string, string> = {};
  for (const f of spec.fields) {
    const v = input[f.key];
    if (v === undefined || v === '') {
      if (f.required) throw new ParamError(`Missing required parameter '${f.key}'`);
      continue;
    }
    if (typeof v !== 'string') throw new ParamError(`Parameter '${f.key}' must be a string`);
    if (v.includes('\0')) throw new ParamError(`Parameter '${f.key}' contains NUL`);
    switch (f.kind) {
      case 'name': if (!NAME.test(v)) throw new ParamError(`'${f.key}' must match ${NAME}`); break;
      case 'enum': if (!f.options!.includes(v)) throw new ParamError(`'${f.key}' must be one of ${f.options!.join(', ')}`); break;
      case 'text': if (v.length > 8000) throw new ParamError(`'${f.key}' is too long (max 8000)`); break;
      case 'path':
        // Absolute only: the CLI resolves relative paths against INIT_CWD, not the cwd we validated.
        if (v.length > 1024 || /[\r\n]/.test(v) || !/^([A-Za-z]:[\\/]|\/|\\\\)/.test(v)) throw new ParamError(`'${f.key}' must be an absolute path`);
        break;
    }
    out[f.key] = v;
  }
  return out;
}

export function displayCommand(file: string, args: string[]): string {
  const q = (a: string) => (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);
  return [file, ...args].map(q).join(' ');
}

export function commandsForNode(n: Pick<GraphNode, 'type' | 'name'>): { id: CommandId; params: Record<string, string> }[] {
  const out: { id: CommandId; params: Record<string, string> }[] = [];
  if (n.type === 'runtime') {
    const p = { runtime: n.name };
    out.push({ id: 'invoke', params: p }, { id: 'dev', params: p }, { id: 'logs', params: p }, { id: 'tracesList', params: p }, { id: 'package', params: p });
  }
  if (n.type === 'harness') out.push({ id: 'invokeHarness', params: { harness: n.name } });
  out.push({ id: 'status', params: {} });
  return out;
}
