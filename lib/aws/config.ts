import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isMock } from '@/lib/exec/mock';

export interface AwsProfile {
  name: string;
  kind: 'sso' | 'login' | 'other';
  region?: string;
  ssoAccountId?: string;
  ssoRoleName?: string;
  ssoStartUrl?: string;
}

export const PROFILE_NAME_RE = /^[A-Za-z0-9_.@][A-Za-z0-9_.@-]{0,127}$/;

export function parseAwsConfig(text: string): AwsProfile[] {
  const sections = new Map<string, Record<string, string>>();
  let cur: Record<string, string> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) { cur = {}; sections.set(sec[1].trim().replace(/\s+/g, ' '), cur); continue; }
    const eq = line.indexOf('=');
    if (!cur || eq < 0) continue;
    cur[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const out: AwsProfile[] = [];
  for (const [key, kv] of sections) {
    let name: string | null = null;
    if (key === 'default') name = 'default';
    else if (key.startsWith('profile ')) name = key.slice('profile '.length).trim();
    if (!name) continue;
    const session = kv.sso_session ? sections.get(`sso-session ${kv.sso_session}`) : undefined;
    const startUrl = kv.sso_start_url ?? session?.sso_start_url;
    const kind: AwsProfile['kind'] = kv.sso_session || kv.sso_start_url ? 'sso' : kv.login_session ? 'login' : 'other';
    out.push({
      name, kind, region: kv.region,
      ssoAccountId: kv.sso_account_id, ssoRoleName: kv.sso_role_name, ssoStartUrl: kind === 'sso' ? startUrl : undefined,
    });
  }
  return out;
}

export async function readProfiles(): Promise<AwsProfile[]> {
  if (isMock()) {
    return [
      { name: 'mock-sso', kind: 'sso', region: 'us-east-1', ssoAccountId: '123456789012', ssoRoleName: 'Developer', ssoStartUrl: 'https://mock.awsapps.com/start' },
      { name: 'mock-login', kind: 'login', region: 'us-east-1' },
    ];
  }
  const file = process.env.AWS_CONFIG_FILE ?? path.join(os.homedir(), '.aws', 'config');
  try { return parseAwsConfig(await fs.readFile(file, 'utf8')); } catch { return []; }
}
