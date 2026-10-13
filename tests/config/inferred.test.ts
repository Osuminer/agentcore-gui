import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseAgentCore } from '@/lib/config/parser';
import type { Graph } from '@/lib/config/types';

const fx = path.join(__dirname, '../../fixtures/demo-project');
const agentcore = JSON.parse(fs.readFileSync(path.join(fx, 'agentcore/agentcore.json'), 'utf8'));
const harness = JSON.parse(fs.readFileSync(path.join(fx, 'app/support_h/harness.json'), 'utf8'));
const g: Graph = parseAgentCore({ root: fx, agentcore, harnesses: { support_h: harness } });
const edge = (from: string, to: string) => g.edges.find((e) => e.from === from && e.to === to);

describe('inferred edges', () => {
  it('connection ARN -> project memory is inferred', () => {
    expect(edge('runtime:orders_agent', 'memory:ordersMemory')?.kind).toBe('inferred');
  });
  it('connection ARN -> project gateway is inferred', () => {
    expect(edge('runtime:orders_agent', 'gateway:tools-gw')?.kind).toBe('inferred');
  });
  it('connection without ARN becomes an external node with a declared edge', () => {
    expect(g.nodes.some((n) => n.id === 'external:browser')).toBe(true);
    expect(edge('runtime:orders_agent', 'external:browser')?.kind).toBe('declared');
  });
  it('runtime -> <runtime>Memory by naming convention is inferred', () => {
    expect(edge('runtime:planner_agent', 'memory:planner_agentMemory')?.kind).toBe('inferred');
  });
  it('does not add a convention edge when the memory is already linked', () => {
    const g2 = parseAgentCore({
      root: fx, harnesses: {},
      agentcore: { name: 'x', runtimes: [{ name: 'a', connections: [{ to: { type: 'memory', arn: 'arn:aws:x:r:1:memory/aMemory-1' } }] }], memories: [{ name: 'aMemory' }] },
    });
    expect(g2.edges.filter((e) => e.from === 'runtime:a' && e.to === 'memory:aMemory')).toHaveLength(1);
  });
  it('harness gateway tool ARN -> gateway is inferred', () => {
    expect(edge('harness:support_h', 'gateway:tools-gw')?.kind).toBe('inferred');
  });
  it('connector knowledge base reference -> KB is inferred', () => {
    expect(edge('gatewayTarget:tools-gw/kb-target', 'knowledgeBase:docs_kb')?.kind).toBe('inferred');
  });
  describe('deployed-resource ARNs carry a project prefix', () => {
    const arnFor = (kind: string, seg: string) => `arn:aws:bedrock-agentcore:us-east-1:123456789012:${kind}/${seg}`;
    const project = (connections: unknown[]) => parseAwsGraph(connections);
    function parseAwsGraph(connections: unknown[]): Graph {
      return parseAgentCore({
        root: fx, harnesses: {},
        agentcore: {
          name: 'x',
          runtimes: [
            { name: 'OrchestratorAgent', connections },
            { name: 'WeatherAgent' },
          ],
          agentCoreGateways: [{ name: 'weather-gateway', targets: [] }],
        },
      });
    }
    const has = (g: Graph, from: string, to: string) => g.edges.some((e) => e.from === from && e.to === to && e.kind === 'inferred');

    it('links a runtime connection whose ARN is <Project>_<Runtime>-<suffix>', () => {
      const g = project([{ id: 'weather-agent', to: { type: 'runtime', arn: arnFor('runtime', 'MyProj_WeatherAgent-AbC123xyz') } }]);
      expect(has(g, 'runtime:OrchestratorAgent', 'runtime:WeatherAgent')).toBe(true);
      expect(g.nodes.some((n) => n.type === 'external')).toBe(false);
    });
    it('links a gateway connection whose ARN is <project>-<gateway>-<suffix>', () => {
      const g = project([{ id: 'gw', to: { type: 'gateway', arn: arnFor('gateway', 'myproj-weather-gateway-0a1b2c3d4e') } }]);
      expect(has(g, 'runtime:OrchestratorAgent', 'gateway:weather-gateway')).toBe(true);
    });
    it('uses the edge label from the connection id', () => {
      const g = project([{ id: 'weather-agent', to: { type: 'runtime', arn: arnFor('runtime', 'MyProj_WeatherAgent-AbC123xyz') } }]);
      expect(g.edges.find((e) => e.to === 'runtime:WeatherAgent')?.label).toBe('weather-agent');
    });
    it('does not match a name that is only a substring of another word', () => {
      const g = project([{ id: 'x', to: { type: 'runtime', arn: arnFor('runtime', 'MyProj_NotWeatherAgent-AbC123xyz') } }]);
      expect(has(g, 'runtime:OrchestratorAgent', 'runtime:WeatherAgent')).toBe(false);
    });
    it('warns about an unmatched ARN, naming the connection and the ARN tail but not the account id', () => {
      const g = project([{ id: 'weather-agent', to: { type: 'runtime', arn: arnFor('runtime', 'Unrelated_Thing-AbC123xyz') } }]);
      const w = g.warnings.find((x) => /weather-agent/.test(x.message));
      expect(w).toBeTruthy();
      expect(w!.message).toContain('Unrelated_Thing-AbC123xyz');
      expect(JSON.stringify(g.warnings)).not.toContain('123456789012');
      expect(g.nodes.some((n) => n.id.startsWith('external:'))).toBe(true);
    });
    it('does not warn for connections that are intentionally external (browser, code interpreter)', () => {
      const g = project([{ id: 'b', to: { type: 'browser' } }]);
      expect(g.warnings.some((x) => /b/.test(x.scope) && /did not match/.test(x.message))).toBe(false);
    });
  });

  it('ARN matching prefers the longest name and requires a boundary', () => {
    const g3 = parseAgentCore({
      root: fx, harnesses: {},
      agentcore: { name: 'x', runtimes: [{ name: 'r', connections: [{ to: { type: 'gateway', arn: 'arn:aws:x:r:1:gateway/gw10-abc' } }] }],
        agentCoreGateways: [{ name: 'gw1', targets: [] }, { name: 'gw10', targets: [] }] },
    });
    expect(g3.edges.some((e) => e.from === 'runtime:r' && e.to === 'gateway:gw10')).toBe(true);
    expect(g3.edges.some((e) => e.from === 'runtime:r' && e.to === 'gateway:gw1')).toBe(false);
  });
});
