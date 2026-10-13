'use client';
import type { NodeType } from '@/lib/config/types';
import { TYPE_STYLE } from '../theme';

export default function Filters({ present, hidden, onToggle }: { present: NodeType[]; hidden: Set<NodeType>; onToggle: (t: NodeType) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Filter by resource type">
      {present.map((t) => {
        const off = hidden.has(t);
        return (
          <button
            key={t} onClick={() => onToggle(t)} aria-pressed={!off}
            className={`rounded-full border px-2 py-0.5 text-xs ${off ? 'border-slate-700 text-slate-500 line-through' : 'text-slate-100'}`}
            style={off ? undefined : { borderColor: TYPE_STYLE[t].color, background: TYPE_STYLE[t].color + '22' }}
          >{TYPE_STYLE[t].label}</button>
        );
      })}
    </div>
  );
}
