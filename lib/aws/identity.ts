import { childEnv, runToCompletion } from '@/lib/exec/run';
import { startExec } from '@/lib/exec';
import { isMock, mockSession } from '@/lib/exec/mock';
import { PROFILE_NAME_RE, readProfiles, type AwsProfile } from './config';

export { extractDeviceInfo } from './device';

export type IdentityResult =
  | { ok: true; account: string; arn: string; role?: string; region?: string }
  | { ok: false; reason: 'expired' | 'missing-profile' | 'missing-cli' | 'error'; message: string };

export function classifyStsFailure(stderr: string, code: number | null, spawnError?: string):
  { reason: 'expired' | 'missing-profile' | 'missing-cli' | 'error'; message: string } {
  if (spawnError && /not found/i.test(spawnError)) return { reason: 'missing-cli', message: 'The AWS CLI (aws) was not found on PATH.' };
  if (/could not be found|ProfileNotFound/i.test(stderr)) return { reason: 'missing-profile', message: 'That AWS profile does not exist in ~/.aws/config.' };
  if (/expired|ExpiredToken|Unable to locate credentials|Error loading SSO Token|sso login|invalid_grant|login session/i.test(stderr)) {
    return { reason: 'expired', message: 'The AWS session has expired or is not logged in.' };
  }
  return { reason: 'error', message: (stderr.trim() || spawnError || `aws exited with code ${code}`).slice(0, 500) };
}

export function roleFromArn(arn: string): string | undefined {
  const m = arn.match(/:assumed-role\/([^/]+)\//);
  return m?.[1];
}

export async function getIdentity(profile: string, region?: string): Promise<IdentityResult> {
  if (!PROFILE_NAME_RE.test(profile)) return { ok: false, reason: 'missing-profile', message: 'Invalid profile name.' };
  if (isMock()) {
    if (profile === 'mock-sso' && !mockSession.loggedIn) return { ok: false, reason: 'expired', message: 'The AWS session has expired or is not logged in.' };
    return { ok: true, account: '123456789012', arn: 'arn:aws:sts::123456789012:assumed-role/Developer/mock', role: 'Developer', region: region ?? 'us-east-1' };
  }
  const run = startExec(
    { file: 'aws', args: ['sts', 'get-caller-identity', '--profile', profile, '--output', 'json'], cwd: process.cwd(), env: childEnv(profile) },
    `aws sts get-caller-identity --profile ${profile}`,
  );
  const res = await runToCompletion(run, 30_000);
  if (res.code !== 0) return { ok: false, ...classifyStsFailure(res.stderr, res.code, res.error) };
  try {
    const d = JSON.parse(res.stdout) as { Account: string; Arn: string };
    return { ok: true, account: d.Account, arn: d.Arn, role: roleFromArn(d.Arn), region };
  } catch {
    return { ok: false, reason: 'error', message: 'Unexpected output from aws sts get-caller-identity.' };
  }
}

export function loginSpec(p: Pick<AwsProfile, 'name' | 'kind'>): { args: string[] } {
  if (!PROFILE_NAME_RE.test(p.name)) throw new Error('Invalid profile name');
  if (p.kind === 'sso') return { args: ['sso', 'login', '--profile', p.name, '--use-device-code'] };
  if (p.kind === 'login') return { args: ['login', '--profile', p.name] };
  throw new Error(`Profile '${p.name}' is not an SSO or console-login profile; it cannot be logged in from here.`);
}

export async function findProfile(name: string): Promise<AwsProfile | undefined> {
  return (await readProfiles()).find((p) => p.name === name);
}
