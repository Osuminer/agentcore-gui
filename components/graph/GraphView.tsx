'use client';
import { useMemo, useState } from 'react';
import { Background, Controls, MarkerType, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Graph, NodeType } from '@/lib/config/types';
import { layoutGraph, visibleSubgraph } from './layout';
import ResourceNode from './ResourceNode';
import Filters from './Filters';

const nodeTypes = { resource: ResourceNode };

interface Props { graph: Graph; selectedId: string | null; onSelect: (id: string | null) => void; onRefresh: () => void; loading: boolean }

export default function GraphView({ graph, selectedId, onSelect, onRefresh, loading }: Props) {
  const [hidden, setHidden] = useState<Set<NodeType>>(new Set());
  const present = useMemo(() => [...new Set(graph.nodes.map((n) => n.type))], [graph.nodes]);
  const { nodes: vn, edges: ve } = useMemo(() => visibleSubgraph(graph, hidden), [graph, hidden]);
  const pos = useMemo(() => layoutGraph(vn, ve), [vn, ve]);

  const rfNodes: Node[] = vn.map((n) => ({ id: n.id, type: 'resource', position: pos[n.id], data: { node: n, selected: n.id === selectedId } }));
  const rfEdges: Edge[] = ve.map((e) => ({
    id: e.id, source: e.from, target: e.to, label: e.label + (e.kind === 'inferred' ? ' (inferred)' : ''),
    animated: false,
    style: { stroke: e.kind === 'inferred' ? '#f59e0b' : '#94a3b8', strokeDasharray: e.kind === 'inferred' ? '6 4' : undefined, strokeWidth: 1.5 },
    labelStyle: { fill: '#cbd5e1', fontSize: 10 }, labelBgStyle: { fill: '#0b1020' },
    markerEnd: { type: MarkerType.ArrowClosed, color: e.kind === 'inferred' ? '#f59e0b' : '#94a3b8' },
  }));

  const toggle = (t: NodeType) => setHidden((h) => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-3 py-2">
        <button onClick={onRefresh} disabled={loading} className="rounded border border-slate-600 px-2 py-1 text-sm hover:bg-slate-800 disabled:opacity-50">{loading ? 'Refreshing…' : '⟳ Refresh'}</button>
        <Filters present={present} hidden={hidden} onToggle={toggle} />
        <span className="ml-auto flex items-center gap-3 text-xs text-slate-400">
          <span><span className="inline-block w-6 border-t-2 border-slate-400 align-middle" /> declared</span>
          <span><span className="inline-block w-6 border-t-2 border-dashed border-amber-500 align-middle" /> inferred</span>
        </span>
      </div>
      {graph.warnings.length > 0 && (
        <details className="border-b border-amber-700/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">
          <summary className="cursor-pointer">⚠ {graph.warnings.length} warning{graph.warnings.length > 1 ? 's' : ''}</summary>
          <ul className="mt-1 list-disc pl-5">{graph.warnings.map((w, i) => <li key={i}><b>{w.scope}</b>: {w.message}</li>)}</ul>
        </details>
      )}
      <div className="min-h-0 flex-1">
        <ReactFlow
          key={graph.root + vn.map((n) => n.id).join(',')}
          nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} fitView minZoom={0.1}
          nodesDraggable={false} nodesConnectable={false} edgesFocusable={false}
          onNodeClick={(_, n) => onSelect(n.id)} onPaneClick={() => onSelect(null)}
          colorMode="dark"
        >
          <Background /><Controls showInteractive={false} /><MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}
