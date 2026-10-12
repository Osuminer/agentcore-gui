import { describe, expect, it } from 'vitest';
import { redact } from '@/lib/exec/redact';

describe('redact', () => {
  it('masks JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz';
    expect(redact(`token: ${jwt}`)).not.toContain(jwt);
  });
  it('masks AWS access key ids', () => {
    expect(redact('key AKIAIOSFODNN7EXAMPLE here')).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(redact('ASIAIOSFODNN7EXAMPLE')).not.toContain('ASIAIOSFODNN7EXAMPLE');
  });
  it('masks Bearer tokens', () => {
    expect(redact('Authorization: Bearer abc.def-ghi_123')).toBe('Authorization: Bearer [redacted]');
  });
  it('masks secret key assignments', () => {
    expect(redact('aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCY')).toContain('[redacted]');
    expect(redact('"clientSecret": "s3cr3t"')).not.toContain('s3cr3t');
    expect(redact('accessToken=abc123')).not.toContain('abc123');
  });
  it('leaves ordinary text alone', () => {
    expect(redact('Deploying orders_agent... done')).toBe('Deploying orders_agent... done');
  });
  it('keeps the device code and URL used for SSO login visible', () => {
    const t = 'Open https://device.sso.us-east-1.amazonaws.com/ and enter ABCD-EFGH';
    expect(redact(t)).toBe(t);
  });
});
