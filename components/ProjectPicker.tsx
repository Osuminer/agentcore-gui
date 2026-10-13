'use client';
import { useEffect, useState } from 'react';
import type { RecentProject } from '@/lib/store/recent';
import { getJson } from '@/lib/ui/api';

interface Props {
  current: string;
  onOpen: (path: string) => Promise<void> | void;
  onCreate: () => void;
  error: string | null;
  refreshKey: number;
}

export default function ProjectPicker({ current, onOpen, onCreate, error, refreshKey }: Props) {
  const [path, setPath] = useState(current);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  useEffect(() => { setPath(current); }, [current]);
  useEffect(() => {
    getJson<{ recent: RecentProject[] }>('/api/project/recent').then((r) => setRecent(r.recent)).catch(() => {});
  }, [refreshKey]);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 bg-slate-900/70 px-4 py-2 text-sm">
      <input
        className="min-w-[24rem] flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 font-mono"
        placeholder="Absolute path to an AgentCore project (contains agentcore/agentcore.json)"
        value={path} onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && path) void onOpen(path); }}
      />
      <button className="rounded bg-blue-600 px-3 py-1 font-medium hover:bg-blue-500 disabled:opacity-50" disabled={!path} onClick={() => onOpen(path)}>Open</button>
      <select className="rounded border border-slate-600 bg-slate-800 px-2 py-1" value="" onChange={(e) => e.target.value && onOpen(e.target.value)}>
        <option value="">Recent…</option>
        {recent.map((r) => <option key={r.path} value={r.path}>{r.name} — {r.path}</option>)}
      </select>
      <button className="rounded border border-slate-600 px-3 py-1 hover:bg-slate-800" onClick={onCreate}>New project…</button>
      {error && <div className="w-full text-red-400" role="alert">{error}</div>}
    </div>
  );
}
