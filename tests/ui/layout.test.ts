import { describe, expect, it } from 'vitest';
import { layoutGraph, visibleSubgraph, NODE_W } from '@/components/graph/layout';
import type { Graph, GraphNode } from '@/lib/config/types';

const n = (id: string, type: GraphNode['type']): GraphNode => ({ id, type, name: id, status: 'unknown', config: {}, envVarNames: [], warnings: [] });
const graph: Graph = {
  projectName: 'p', root: '/p', warnings: [],
  nodes: [n('a', 'runtime'), n('b', 'memory'), n('c', 'gateway')],
  edges: [
    { id: '1', from: 'a', to: 'b', kind: 'declared', label: 'x', source: '' },
    { id: '2', from: 'c', to: 'a', kind: 'inferred', label: 'y', source: '' },
  ],
};

describe('layoutGraph', () => {
  it('positions every node, left-to-right by edge direction', () => {
    const pos = layoutGraph(graph.nodes, graph.edges);
    expect(Object.keys(pos).sort()).toEqual(['a', 'b', 'c']);
    expect(pos.c.x).toBeLessThan(pos.a.x);
    expect(pos.a.x).toBeLessThan(pos.b.x);
    expect(pos.b.x - pos.a.x).toBeGreaterThanOrEqual(NODE_W);
  });
  it('handles an empty graph and ignores edges to unknown nodes', () => {
    expect(layoutGraph([], [])).toEqual({});
    expect(Object.keys(layoutGraph([{ id: 'a' }], [{ from: 'a', to: 'ghost' }]))).toEqual(['a']);
  });
  it('handles cycles without throwing', () => {
    expect(() => layoutGraph([{ id: 'a' }, { id: 'b' }], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])).not.toThrow();
  });
});

describe('visibleSubgraph', () => {
  it('hides nodes of filtered types and their edges', () => {
    const v = visibleSubgraph(graph, new Set(['memory']));
    expect(v.nodes.map((x) => x.id)).toEqual(['a', 'c']);
    expect(v.edges.map((e) => e.id)).toEqual(['2']);
  });
  it('shows everything when nothing is hidden', () => {
    const v = visibleSubgraph(graph, new Set());
    expect(v.nodes).toHaveLength(3);
    expect(v.edges).toHaveLength(2);
  });
});
