import { describe, expect, it } from 'vitest';
import { COMMANDS, ParamError, commandsForNode, displayCommand, isCommandId, validateParams } from '@/lib/cli/catalog';

const argv = (id: keyof typeof COMMANDS, p: Record<string, string> = {}) => COMMANDS[id].build(validateParams(COMMANDS[id], p));

describe('argv builders', () => {
  it('validate/status always pass --json (non-interactive)', () => {
    expect(argv('validate')).toEqual(['validate', '--json']);
    expect(argv('status')).toEqual(['status', '--json']);
  });
  it('deploy variants', () => {
    expect(argv('deploy')).toEqual(['deploy', '--yes', '--json', '-v']);
    expect(argv('deployDiff')).toEqual(['deploy', '--diff', '--json']);
    expect(argv('deployDryRun')).toEqual(['deploy', '--dry-run', '--json']);
  });
  it('invoke attaches the prompt with = so it can never become a flag', () => {
    expect(argv('invoke', { prompt: '--runtime evil', runtime: 'orders_agent' }))
      .toEqual(['invoke', '--prompt=--runtime evil', '--stream', '--runtime', 'orders_agent']);
  });
  it('dev skips deploy and streams logs', () => {
    expect(argv('dev', { runtime: 'a' })).toEqual(['dev', '--logs', '--skip-deploy', '--runtime', 'a']);
  });
  it('logs uses search mode', () => {
    expect(argv('logs', { runtime: 'a', since: '1h' })).toEqual(['logs', '--json', '--since', '1h', '--limit', '200', '--runtime', 'a']);
  });
  it('create builds a TypeScript scaffold', () => {
    expect(argv('create', { projectName: 'demo1', agentName: 'agent1', framework: 'VercelAI', modelProvider: 'Bedrock', outputDir: 'C:/work' }))
      .toEqual(['create', '--project-name', 'demo1', '--name', 'agent1', '--language', 'TypeScript', '--framework', 'VercelAI',
        '--model-provider', 'Bedrock', '--memory', 'none', '--skip-git', '--skip-install', '--output-dir', 'C:/work', '--json']);
  });
  it('createDryRun adds --dry-run', () => {
    expect(argv('createDryRun', { projectName: 'demo1', agentName: 'agent1', framework: 'VercelAI', modelProvider: 'Bedrock', outputDir: 'C:/work' }))
      .toContain('--dry-run');
  });
});

describe('metadata', () => {
  it('flags AWS-touching and long-running commands', () => {
    expect(COMMANDS.deploy.touchesAws).toBe(true);
    expect(COMMANDS.validate.touchesAws).toBe(false);
    expect(COMMANDS.dev.longRunning).toBe(true);
    expect(COMMANDS.status.touchesAws).toBe(true);
  });
  it('isCommandId rejects unknown ids', () => {
    expect(isCommandId('deploy')).toBe(true);
    expect(isCommandId('remove')).toBe(false);
    expect(isCommandId('add')).toBe(false);
    expect(isCommandId('fetchAccess')).toBe(false);
  });
});

describe('validateParams', () => {
  it('rejects unknown keys', () => {
    expect(() => validateParams(COMMANDS.validate, { extra: 'x' })).toThrow(ParamError);
  });
  it('rejects missing required fields', () => {
    expect(() => validateParams(COMMANDS.invoke, {})).toThrow(/prompt/);
  });
  it.each(['-rf', 'a b', 'a;b', 'x'.repeat(101), '1abc', 'a\nb'])('rejects bad name %j', (v) => {
    expect(() => validateParams(COMMANDS.dev, { runtime: v })).toThrow(ParamError);
  });
  it('rejects NUL and oversized prompts', () => {
    expect(() => validateParams(COMMANDS.invoke, { prompt: 'a\0b' })).toThrow(ParamError);
    expect(() => validateParams(COMMANDS.invoke, { prompt: 'x'.repeat(8001) })).toThrow(ParamError);
  });
  it('accepts multi-line prompts', () => {
    expect(validateParams(COMMANDS.invoke, { prompt: 'a\nb' })).toEqual({ prompt: 'a\nb' });
  });
  it('rejects values outside an enum', () => {
    expect(() => validateParams(COMMANDS.logs, { since: '999y' })).toThrow(ParamError);
  });
  it('rejects non-object params', () => {
    expect(() => validateParams(COMMANDS.validate, null)).toThrow(ParamError);
    expect(() => validateParams(COMMANDS.validate, 'x')).toThrow(ParamError);
  });
  it('rejects non-string values', () => {
    expect(() => validateParams(COMMANDS.dev, { runtime: 5 as unknown as string })).toThrow(ParamError);
  });
});

describe('displayCommand', () => {
  it('quotes args with spaces', () => {
    expect(displayCommand('agentcore', ['invoke', '--prompt=hello world'])).toBe('agentcore invoke "--prompt=hello world"');
  });
  it('leaves simple args bare', () => {
    expect(displayCommand('agentcore', ['status', '--json'])).toBe('agentcore status --json');
  });
});

describe('commandsForNode', () => {
  it('runtime nodes offer invoke/dev/logs/traces/package', () => {
    const ids = commandsForNode({ type: 'runtime', name: 'a' }).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['invoke', 'dev', 'logs', 'tracesList', 'package']));
  });
  it('harness nodes offer invokeHarness', () => {
    expect(commandsForNode({ type: 'harness', name: 'h' }).map((c) => c.id)).toContain('invokeHarness');
  });
  it('always offers status; prefills the node name', () => {
    expect(commandsForNode({ type: 'memory', name: 'm' }).map((c) => c.id)).toContain('status');
    expect(commandsForNode({ type: 'runtime', name: 'a' }).find((c) => c.id === 'invoke')!.params).toEqual({ runtime: 'a' });
  });
});
