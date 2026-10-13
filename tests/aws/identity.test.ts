import { describe, expect, it } from 'vitest';
import { classifyStsFailure, extractDeviceInfo, loginSpec, roleFromArn } from '@/lib/aws/identity';

describe('classifyStsFailure', () => {
  it('detects expired SSO', () => {
    expect(classifyStsFailure('Error loading SSO Token: Token for https://x has expired', 255).reason).toBe('expired');
    expect(classifyStsFailure('The SSO session associated with this profile has expired or is otherwise invalid', 255).reason).toBe('expired');
    expect(classifyStsFailure('Unable to locate credentials. You can configure credentials by running "aws configure".', 255).reason).toBe('expired');
    expect(classifyStsFailure('An error occurred (ExpiredToken) when calling the GetCallerIdentity operation', 254).reason).toBe('expired');
  });
  it('detects a missing profile', () => {
    expect(classifyStsFailure('The config profile (nope) could not be found', 255).reason).toBe('missing-profile');
  });
  it('detects a missing CLI', () => {
    expect(classifyStsFailure('', null, "'aws' was not found on PATH").reason).toBe('missing-cli');
  });
  it('falls back to error with a message', () => {
    const r = classifyStsFailure('something odd', 1);
    expect(r.reason).toBe('error');
    expect(r.message).toContain('something odd');
  });
});

describe('roleFromArn', () => {
  it('extracts assumed-role names', () => {
    expect(roleFromArn('arn:aws:sts::123456789012:assumed-role/AWSReservedSSO_Dev_abc/jane')).toBe('AWSReservedSSO_Dev_abc');
  });
  it('returns undefined for users/root', () => {
    expect(roleFromArn('arn:aws:iam::123456789012:root')).toBeUndefined();
  });
});

describe('loginSpec', () => {
  it('uses aws sso login with device code for SSO profiles', () => {
    expect(loginSpec({ name: 'dev', kind: 'sso' }).args).toEqual(['sso', 'login', '--profile', 'dev', '--use-device-code']);
  });
  it('uses plain aws login (browser callback; --remote needs stdin) for console-login profiles', () => {
    expect(loginSpec({ name: 'default', kind: 'login' }).args).toEqual(['login', '--profile', 'default']);
  });
  it('throws for profiles that cannot log in', () => {
    expect(() => loginSpec({ name: 'keys', kind: 'other' })).toThrow();
  });
});

describe('extractDeviceInfo', () => {
  it('finds URL and code', () => {
    const t = 'Open the following URL:\nhttps://device.sso.us-east-1.amazonaws.com/\nand enter the code: ABCD-EFGH\n';
    expect(extractDeviceInfo(t)).toEqual({ url: 'https://device.sso.us-east-1.amazonaws.com/', code: 'ABCD-EFGH' });
  });
  it('prefers a URL that already embeds the code', () => {
    const t = 'https://device.sso.us-east-1.amazonaws.com/?user_code=WXYZ-1234';
    expect(extractDeviceInfo(t).url).toContain('user_code=WXYZ-1234');
  });
  it('returns an empty object when nothing is present', () => {
    expect(extractDeviceInfo('hello')).toEqual({});
  });
});
