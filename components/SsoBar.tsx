'use client';
import { useCallback, useEffect, useState } from 'react';
import type { AwsProfile } from '@/lib/aws/config';
import type { IdentityResult } from '@/lib/aws/identity';
import { getJson, postJson } from '@/lib/ui/api';

interface Props {
  profile: string;
  onProfile: (p: string) => void;
  identity: IdentityResult | null;
  onIdentity: (i: IdentityResult | null) => void;
  onLoginRun: (runId: string, title: string) => void;
  loginDoneSignal: number;   // increments when a login run exits; triggers a re-check
}

export default function SsoBar({ profile, onProfile, identity, onIdentity, onLoginRun, loginDoneSignal }: Props) {
  const [profiles, setProfiles] = useState<AwsProfile[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getJson<{ profiles: AwsProfile[] }>('/api/aws/profiles').then((r) => setProfiles(r.profiles)).catch((e) => setErr(e.message));
  }, []);

  const check = useCallback(async (name: string) => {
    if (!name) { onIdentity(null); return; }
    setBusy(true); setErr(null);
    try { onIdentity(await postJson<IdentityResult>('/api/aws/whoami', { profile: name })); }
    catch (e) { setErr((e as Error).message); onIdentity(null); }
    finally { setBusy(false); }
  }, [onIdentity]);

  useEffect(() => { if (profile) void check(profile); }, [profile, check, loginDoneSignal]);

  const selected = profiles.find((p) => p.name === profile);
  const canLogin = selected && (selected.kind === 'sso' || selected.kind === 'login');

  async function login() {
    setErr(null);
    try {
      const r = await postJson<{ runId: string; display: string }>('/api/aws/login', { profile });
      onLoginRun(r.runId, `Log in: ${r.display}`);
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-700 bg-slate-900 px-4 py-2 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-slate-400">AWS profile</span>
        <select className="rounded border border-slate-600 bg-slate-800 px-2 py-1" value={profile} onChange={(e) => onProfile(e.target.value)}>
          <option value="">— select —</option>
          {profiles.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.kind})</option>)}
        </select>
      </label>
      {busy && <span className="text-slate-400">checking…</span>}
      {identity?.ok && (
        <span className="rounded border border-emerald-600/50 bg-emerald-500/10 px-2 py-1 text-emerald-300" data-testid="identity-ok">
          Account {identity.account} · {identity.role ?? 'user/root'} · {identity.region ?? selected?.region ?? 'region ?'}
        </span>
      )}
      {identity && !identity.ok && (
        <span className="flex items-center gap-2 rounded border border-amber-600/50 bg-amber-500/10 px-2 py-1 text-amber-300" data-testid="identity-bad">
          {identity.message}
          {identity.reason === 'expired' && canLogin && (
            <button className="rounded bg-amber-500 px-2 py-0.5 font-medium text-slate-900" onClick={login}>Log in</button>
          )}
        </span>
      )}
      {profiles.length === 0 && <span className="text-slate-400">No profiles found in ~/.aws/config</span>}
      {err && <span className="text-red-400">{err}</span>}
    </div>
  );
}
