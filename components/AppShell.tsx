'use client';
import { useCallback, useState } from 'react';
import type { Graph } from '@/lib/config/types';
import type { IdentityResult } from '@/lib/aws/identity';
import type { CommandId } from '@/lib/cli/catalog';
import { postJson } from '@/lib/ui/api';
import SsoBar from './SsoBar';
import ProjectPicker from './ProjectPicker';

export interface ActiveRun { id: string; title: string }
export interface PendingAction { commandId: CommandId; params: Record<string, string> }

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

  return (
    <div className="flex h-screen flex-col">
      <SsoBar
        profile={profile} onProfile={setProfile} identity={identity} onIdentity={setIdentity}
        onLoginRun={(id, title) => setActiveRun({ id, title })} loginDoneSignal={loginTick}
      />
      <ProjectPicker current={projectPath} onOpen={(p) => load(p, true)} onCreate={() => setPending({ commandId: 'createDryRun', params: {} })} error={error} refreshKey={recentKey} />
      <main className="relative flex min-h-0 flex-1">
        {!graph && <div className="m-auto text-slate-400">{loading ? 'Loading…' : 'Open a project to see its graph.'}</div>}
        {graph && (
          <pre className="p-4 text-xs" data-testid="graph-summary">
            {JSON.stringify({ nodes: graph.nodes.length, edges: graph.edges.length, warnings: graph.warnings.length, note, selectedId, run: activeRun?.id, pending: pending?.commandId, refreshable: typeof refresh, setLoginTick: typeof setLoginTick }, null, 2)}
          </pre>
        )}
      </main>
    </div>
  );
}
