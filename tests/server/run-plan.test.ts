import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { planRun, buildProjectGraph } from '@/lib/server/project';

const fx = path.join(__dirname, '../../fixtures/demo-project');
beforeAll(() => { process.env.MOCK = '1'; });
afterAll(() => { delete process.env.MOCK; });

describe('planRun', () => {
  it('builds argv, cwd and display for an allowlisted command', async () => {
    const p = await planRun({ commandId: 'status', params: {}, projectPath: fx, profile: 'mock-sso' });
    expect(p.exec.file).toBe('agentcore');
    expect(p.exec.args).toEqual(['status', '--json']);
    expect(p.display).toBe('agentcore status --json');
    expect(path.resolve(p.exec.cwd)).toBe(path.resolve(fx));
    expect(p.exec.env.AWS_PROFILE).toBe('mock-sso');
  });
  it('rejects a command that is not on the allowlist', async () => {
    await expect(planRun({ commandId: 'remove', params: {}, projectPath: fx })).rejects.toThrow(/Unknown command/);
  });
  it('rejects a non-project directory', async () => {
    await expect(planRun({ commandId: 'validate', params: {}, projectPath: path.join(fx, 'app') })).rejects.toThrow(/Not an AgentCore project/);
  });
  it('rejects invalid params', async () => {
    await expect(planRun({ commandId: 'dev', params: { runtime: '-x' }, projectPath: fx })).rejects.toThrow();
  });
  it('requires a profile for AWS-touching commands', async () => {
    await expect(planRun({ commandId: 'deploy', params: {}, projectPath: fx })).rejects.toThrow(/profile/i);
  });
  it('does not require a profile for local commands', async () => {
    await expect(planRun({ commandId: 'validate', params: {}, projectPath: fx })).resolves.toBeTruthy();
  });
  it('create runs in the output directory, not a project', async () => {
    const p = await planRun({ commandId: 'createDryRun', params: { projectName: 'demo1', agentName: 'agent1', framework: 'VercelAI', modelProvider: 'Bedrock', outputDir: fx } });
    expect(path.resolve(p.exec.cwd)).toBe(path.resolve(fx));
  });
  it('create refuses a non-existent output directory', async () => {
    await expect(planRun({ commandId: 'createDryRun', params: { projectName: 'demo1', agentName: 'agent1', framework: 'VercelAI', modelProvider: 'Bedrock', outputDir: path.join(fx, 'nope') } })).rejects.toThrow();
  });
});

describe('buildProjectGraph (mock mode)', () => {
  it('skips status without a profile and says so', async () => {
    const r = await buildProjectGraph(fx);
    expect(r.status).toBe('skipped');
    expect(r.note).toMatch(/profile/i);
    expect(r.graph.nodes.every((n) => n.status === 'unknown')).toBe(true);
  });
  it('skips status when the session is expired', async () => {
    const r = await buildProjectGraph(fx, 'mock-sso');
    expect(r.status).toBe('skipped');
    expect(r.note).toMatch(/unavailable/i);
  });
  it('applies deployment status when logged in', async () => {
    const r = await buildProjectGraph(fx, 'mock-login');
    expect(r.status).toBe('ok');
    expect(r.graph.nodes.find((n) => n.id === 'runtime:orders_agent')!.status).toBe('deployed');
    expect(r.graph.nodes.find((n) => n.id === 'runtime:planner_agent')!.status).toBe('not-deployed');
    expect(r.graph.nodes.find((n) => n.id === 'gatewayTarget:tools-gw/crm-mcp')!.status).toBe('deployed');
  });
});
