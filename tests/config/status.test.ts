import { describe, expect, it } from 'vitest';
import { applyStatus } from '@/lib/config/status';
import type { Graph } from '@/lib/config/types';

const base = (): Graph => ({
  projectName: 'p', root: '/p', warnings: [], edges: [],
  nodes: [
    { id: 'runtime:a', type: 'runtime', name: 'a', status: 'unknown', config: {}, envVarNames: [], warnings: [] },
    { id: 'gateway:g', type: 'gateway', name: 'g', status: 'unknown', config: {}, envVarNames: [], warnings: [] },
    { id: 'gatewayTarget:g/t', type: 'gatewayTarget', name: 't', status: 'unknown', config: {}, envVarNames: [], warnings: [], parent: 'gateway:g' },
    { id: 'memory:m', type: 'memory', name: 'm', status: 'unknown', config: {}, envVarNames: [], warnings: [] },
  ],
});
const byId = (g: Graph, id: string) => g.nodes.find((n) => n.id === id)!;

describe('applyStatus', () => {
  it('maps deployment states', () => {
    const g = applyStatus(base(), [
      { resourceType: 'agent', name: 'a', deploymentState: 'deployed' },
      { resourceType: 'gateway', name: 'g', deploymentState: 'local-only', detail: '1 target' },
      { resourceType: 'memory', name: 'm', deploymentState: 'pending-removal' },
    ], { ok: true });
    expect(byId(g, 'runtime:a').status).toBe('deployed');
    expect(byId(g, 'gateway:g').status).toBe('not-deployed');
    expect(byId(g, 'gateway:g').statusDetail).toBe('1 target');
    expect(byId(g, 'memory:m').status).toBe('pending-removal');
  });
  it('targets inherit their gateway status', () => {
    const g = applyStatus(base(), [{ resourceType: 'gateway', name: 'g', deploymentState: 'deployed' }], null);
    expect(byId(g, 'gatewayTarget:g/t').status).toBe('deployed');
  });
  it('leaves nodes unknown when status is null', () => {
    expect(byId(applyStatus(base(), null, null), 'runtime:a').status).toBe('unknown');
  });
  it('marks nodes named in a validate error as error and adds a warning', () => {
    const g = applyStatus(base(), [], { ok: false, error: 'agentCoreGateways[0]: Target "t" is bad' });
    expect(byId(g, 'gatewayTarget:g/t').status).toBe('error');
    expect(g.warnings.some((w) => w.scope === 'validate')).toBe(true);
  });
  it('does not mutate the input graph', () => {
    const input = base();
    applyStatus(input, [{ resourceType: 'agent', name: 'a', deploymentState: 'deployed' }], null);
    expect(byId(input, 'runtime:a').status).toBe('unknown');
  });
});
