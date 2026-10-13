'use client';
import { useCallback, useState } from 'react';
import type { Graph } from '@/lib/config/types';
import type { IdentityResult } from '@/lib/aws/identity';
import type { CommandId } from '@/lib/cli/catalog';
import { postJson } from '@/lib/ui/api';
import SsoBar from './SsoBar';
import ProjectPicker from './ProjectPicker';
import GraphView from './graph/GraphView';
import NodePanel from './NodePanel';
import RunDialog from './RunDialog';
import CommandDrawer from './CommandDrawer';

export interface ActiveRun { id: string; title: string }
export interface PendingAction { commandId: CommandId; params: Record<string, string> }

const TOOLBAR: { id: CommandId; label: string }[] = [
  { id: 'validate', label: 'Validate' },
  { id: 'package', label: 'Package' },
  { id: 'deployDiff', label: 'Deploy diff' },
  { id: 'deploy', label: 'Deploy…' },
];

export default function AppShell() {
  const [profile, setProfile] = useState('');
  const [identity, setIdentity] = useState<IdentityResult | null>(null);
  const [projectPath, setProjectPath] = useState('');
  const [graph, setGraph] = useState<Graph | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [loginTick, setLoginTick] = useState(0);
  const [recentKey, setRecentKey] = useState(0);

  const load = useCallback(async (path: string, open: boolean) => {
    setLoading(true); setError(null);
    try {
      const r = await postJson<{ graph: Graph; note?: string }>(open ? '/api/project/open' : '/api/project/graph', { path, profile: profile || undefined });
      setGraph(r.graph); setNote(r.note ?? null); setProjectPath(r.graph.root);
      if (open) { setSelectedId(null); setRecentKey((k) => k + 1); }
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [profile]);

  const refresh = useCallback(() => { if (projectPath) void load(projectPath, false); }, [projectPath, load]);
  const selected = graph?.nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="flex h-screen flex-col">
      <SsoBar
        profile={profile} onProfile={setProfile} identity={identity} onIdentity={setIdentity}
        onLoginRun={(id, title) => setActiveRun({ id, title })} loginDoneSignal={loginTick}
      />
      <ProjectPicker
        current={projectPath} onOpen={(p) => load(p, true)} error={error} refreshKey={recentKey}
        onCreate={() => setPending({ commandId: 'createDryRun', params: {} })}
      />
      {graph && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/50 px-4 py-1 text-sm">
          <span className="font-semibold">{graph.projectName}</span>
          {note && <span className="text-xs text-amber-300">{note}</span>}
          <span className="ml-auto flex gap-2">
            {TOOLBAR.map((t) => (
              <button key={t.id} className="rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-800" onClick={() => setPending({ commandId: t.id, params: {} })}>{t.label}</button>
            ))}
          </span>
        </div>
      )}
      <main className="relative flex min-h-0 flex-1">
        {!graph && <div className="m-auto text-slate-400">{loading ? 'Loading…' : 'Open a project to see its graph.'}</div>}
        {graph && <GraphView graph={graph} selectedId={selectedId} onSelect={setSelectedId} onRefresh={refresh} loading={loading} />}
        {graph && selected && (
          <NodePanel graph={graph} node={selected} onSelect={setSelectedId} onClose={() => setSelectedId(null)} onRun={(a) => setPending(a)} />
        )}
      </main>
      <CommandDrawer
        run={activeRun} onClose={() => setActiveRun(null)}
        onExit={(code) => {
          if (activeRun?.title.startsWith('Log in')) setLoginTick((t) => t + 1);
          else if (code === 0 && graph) refresh();
        }}
      />
      <RunDialog
        action={pending} projectPath={projectPath} profile={profile}
        onCancel={() => setPending(null)}
        onStarted={(id, title) => { setPending(null); setActiveRun({ id, title }); }}
        onSwitch={(id, params) => setPending({ commandId: id as CommandId, params })}
      />
    </div>
  );
}
