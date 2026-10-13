import { describe, expect, it } from 'vitest';
import { PROFILE_NAME_RE, parseAwsConfig } from '@/lib/aws/config';

const CFG = `
[default]
login_session = arn:aws:iam::111111111111:root
region = us-east-1

[profile dev-sso]
sso_session = corp
sso_account_id = 222222222222
sso_role_name = Developer
region = eu-west-1

[profile legacy]
sso_start_url = https://legacy.awsapps.com/start
sso_region = us-east-1
sso_account_id = 333333333333
sso_role_name = Admin

[profile keys]
aws_access_key_id = AKIAXXXXXXXXXXXXXXXX
aws_secret_access_key = topsecret
region = us-west-2

[sso-session corp]
sso_start_url = https://corp.awsapps.com/start
sso_region = us-east-1
`;

describe('parseAwsConfig', () => {
  const ps = parseAwsConfig(CFG);
  const by = (n: string) => ps.find((p) => p.name === n)!;
  it('classifies profile kinds', () => {
    expect(by('default').kind).toBe('login');
    expect(by('dev-sso').kind).toBe('sso');
    expect(by('legacy').kind).toBe('sso');
    expect(by('keys').kind).toBe('other');
  });
  it('resolves sso-session start URL', () => {
    expect(by('dev-sso').ssoStartUrl).toBe('https://corp.awsapps.com/start');
    expect(by('dev-sso').ssoAccountId).toBe('222222222222');
    expect(by('dev-sso').ssoRoleName).toBe('Developer');
    expect(by('dev-sso').region).toBe('eu-west-1');
  });
  it('never exposes credential keys', () => {
    expect(JSON.stringify(ps)).not.toMatch(/topsecret|AKIAXXXXXXXXXXXXXXXX/);
  });
  it('does not list sso-session sections as profiles', () => {
    expect(ps.map((p) => p.name)).not.toContain('corp');
  });
  it('handles CRLF, comments, and empty input', () => {
    expect(parseAwsConfig('# c\r\n[profile a]\r\nregion=us-east-1\r\n')[0]).toMatchObject({ name: 'a', region: 'us-east-1' });
    expect(parseAwsConfig('')).toEqual([]);
  });
});

describe('PROFILE_NAME_RE', () => {
  it.each(['default', 'dev-sso', 'a.b_c@d'])('accepts %s', (n) => expect(PROFILE_NAME_RE.test(n)).toBe(true));
  it.each(['', '-x', 'a b', 'a;b', 'x'.repeat(129)])('rejects %j', (n) => expect(PROFILE_NAME_RE.test(n)).toBe(false));
});
