'use client';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphNode } from '@/lib/config/types';
import { STATUS_STYLE, TYPE_STYLE } from '../theme';

export type ResourceNodeData = { node: GraphNode; selected: boolean };

export default function ResourceNode({ data }: NodeProps) {
  const { node, selected } = data as ResourceNodeData;
  const t = TYPE_STYLE[node.type];
  const s = STATUS_STYLE[node.status];
  return (
    <div
      className={`w-[220px] rounded-md border bg-slate-800 px-3 py-2 shadow ${selected ? 'ring-2 ring-white' : ''}`}
      style={{ borderColor: t.color, borderLeftWidth: 6 }}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-500" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide" style={{ color: t.color }}>{t.label}</span>
        {node.warnings.length > 0 && <span title={node.warnings.join('\n')} className="text-amber-400">⚠</span>}
      </div>
      <div className="truncate text-sm font-medium text-slate-100" title={node.name}>{node.name}</div>
      <span className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-[10px] ${s.className}`}>{s.label}</span>
      <Handle type="source" position={Position.Right} className="!bg-slate-500" />
    </div>
  );
}
