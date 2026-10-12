import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseAgentCore, nodeId } from '@/lib/config/parser';
import { MASK } from '@/lib/config/sanitize';
import type { Graph } from '@/lib/config/types';

const fx = path.join(__dirname, '../../fixtures/demo-project');
const agentcore = JSON.parse(fs.readFileSync(path.join(fx, 'agentcore/agentcore.json'), 'utf8'));
const harness = JSON.parse(fs.readFileSync(path.join(fx, 'app/support_h/harness.json'), 'utf8'));

function parse(over: Partial<{ agentcore: unknown; harnesses: Record<string, unknown> }> = {}): Graph {
  return parseAgentCore({ root: fx, agentcore: over.agentcore ?? agentcore, harnesses: over.harnesses ?? { support_h: harness } });
}
const hasEdge = (g: Graph, from: string, to: string, kind?: 'declared' | 'inferred') =>
  g.edges.some((e) => e.from === from && e.to === to && (!kind || e.kind === kind));

describe('nodes', () => {
  const g = parse();
  it('creates a node per resource across types', () => {
    expect(g.nodes.length).toBeGreaterThanOrEqual(16);
    expect(g.projectName).toBe('demo');
    for (const id of ['runtime:orders_agent', 'memory:ordersMemory', 'gateway:tools-gw', 'gatewayTarget:tools-gw/crm-mcp',
      'policyEngine:guardrails', 'policy:guardrails/deny_refunds', 'harness:support_h', 'capacityProvider:pool1',
      'knowledgeBase:docs_kb', 'credential:crm_oauth', 'evaluator:quality', 'onlineEval:orders_eval']) {
      expect(g.nodes.some((n) => n.id === id), id).toBe(true);
    }
  });
  it('records env var names but masks their values', () => {
    const n = g.nodes.find((x) => x.id === 'runtime:orders_agent')!;
    expect(n.envVarNames).toEqual(['ORDERS_API_KEY', 'LOG_LEVEL']);
    expect(JSON.stringify(n.config)).not.toContain('sk-live-123');
    expect(JSON.stringify(n.config)).toContain(MASK);
  });
  it('masks secret-looking fields', () => {
    const n = g.nodes.find((x) => x.id === 'credential:crm_oauth')!;
    expect(JSON.stringify(n.config)).not.toContain('shh-do-not-show');
  });
  it('sets sourcePath for runtimes and harnesses', () => {
    expect(g.nodes.find((x) => x.id === 'runtime:orders_agent')!.sourcePath).toBe('app/orders_agent/');
    expect(g.nodes.find((x) => x.id === 'harness:support_h')!.sourcePath).toBe('app/support_h');
  });
  it('omits child collections from parent config', () => {
    const gw = g.nodes.find((x) => x.id === 'gateway:tools-gw')!;
    expect(gw.config).not.toHaveProperty('targets');
  });
});

describe('declared edges', () => {
  const g = parse();
  it.each([
    ['gateway:tools-gw', 'gatewayTarget:tools-gw/planner-target'],
    ['gatewayTarget:tools-gw/planner-target', 'runtime:planner_agent'],
    ['gatewayTarget:tools-gw/crm-mcp', 'credential:crm_oauth'],
    ['gateway:tools-gw', 'policyEngine:guardrails'],
    ['knowledgeBase:docs_kb', 'gateway:tools-gw'],
    ['runtime:planner_agent', 'capacityProvider:pool1'],
    ['policyEngine:guardrails', 'policy:guardrails/deny_refunds'],
    ['onlineEval:orders_eval', 'runtime:orders_agent'],
    ['onlineEval:orders_eval', 'evaluator:quality'],
    ['harness:support_h', 'memory:ordersMemory'],
  ])('%s -> %s', (from, to) => {
    expect(hasEdge(g, from, to, 'declared')).toBe(true);
  });
});

describe('warnings (never throw)', () => {
  it('warns on unknown top-level sections', () => {
    expect(parse().warnings.some((w) => /futureThing/.test(w.message))).toBe(true);
  });
  it('warns on dangling references', () => {
    expect(parse().warnings.some((w) => /missing_eval/.test(w.message))).toBe(true);
  });
  it('tolerates a non-object document', () => {
    const g = parse({ agentcore: 'nope' });
    expect(g.nodes).toEqual([]);
    expect(g.warnings.length).toBeGreaterThan(0);
  });
  it('tolerates a section that is not an array', () => {
    const g = parse({ agentcore: { name: 'x', runtimes: { oops: true } }, harnesses: {} });
    expect(g.warnings.some((w) => w.scope === 'runtimes')).toBe(true);
  });
  it('skips items without a name', () => {
    const g = parse({ agentcore: { name: 'x', runtimes: [{ build: 'CodeZip' }, { name: 'ok' }] }, harnesses: {} });
    expect(g.nodes.map((n) => n.id)).toEqual(['runtime:ok']);
    expect(g.warnings.some((w) => /without a name/.test(w.message))).toBe(true);
  });
  it('keeps same-named targets in different gateways distinct', () => {
    const t = { name: 't', targetType: 'mcpServer', endpoint: 'https://x' };
    const g = parse({ agentcore: { name: 'x', agentCoreGateways: [{ name: 'a', targets: [t] }, { name: 'b', targets: [t] }] }, harnesses: {} });
    expect(g.nodes.filter((n) => n.type === 'gatewayTarget').map((n) => n.id).sort()).toEqual(['gatewayTarget:a/t', 'gatewayTarget:b/t']);
  });
  it('uses the same name across types without collision', () => {
    const g = parse({ agentcore: { name: 'x', runtimes: [{ name: 'same' }], memories: [{ name: 'same' }] }, harnesses: {} });
    expect(new Set(g.nodes.map((n) => n.id)).size).toBe(2);
  });
  it('reports a harness whose file could not be loaded', () => {
    const g = parse({ harnesses: { support_h: { __error: 'File not found' } } });
    expect(g.warnings.some((w) => /support_h/.test(w.message) && /File not found/.test(w.message))).toBe(true);
    expect(g.nodes.some((n) => n.id === 'harness:support_h')).toBe(true);
  });
});

describe('nodeId', () => {
  it('namespaces by type', () => {
    expect(nodeId('runtime', 'a')).toBe('runtime:a');
  });
});
