import { describe, expect, it } from 'vitest';
import { checkRequest } from '@/lib/security/guard';

describe('checkRequest', () => {
  it('allows GET to 127.0.0.1', () => {
    expect(checkRequest({ host: '127.0.0.1:4317', origin: null, method: 'GET' })).toEqual({ ok: true });
  });
  it('allows localhost', () => {
    expect(checkRequest({ host: 'localhost:4317', origin: null, method: 'GET' }).ok).toBe(true);
  });
  it('rejects a foreign Host (DNS rebinding)', () => {
    expect(checkRequest({ host: 'evil.example.com', origin: null, method: 'GET' }).ok).toBe(false);
  });
  it('rejects missing Host', () => {
    expect(checkRequest({ host: null, origin: null, method: 'GET' }).ok).toBe(false);
  });
  it('rejects POST without Origin', () => {
    expect(checkRequest({ host: '127.0.0.1:4317', origin: null, method: 'POST' }).ok).toBe(false);
  });
  it('rejects POST from a different origin', () => {
    expect(checkRequest({ host: '127.0.0.1:4317', origin: 'https://evil.example.com', method: 'POST' }).ok).toBe(false);
  });
  it('rejects POST from same hostname but different port', () => {
    expect(checkRequest({ host: '127.0.0.1:4317', origin: 'http://127.0.0.1:9999', method: 'POST' }).ok).toBe(false);
  });
  it('allows POST from the same origin', () => {
    expect(checkRequest({ host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', method: 'POST' }).ok).toBe(true);
  });
  it('applies the Origin rule to DELETE', () => {
    expect(checkRequest({ host: '127.0.0.1:4317', origin: null, method: 'DELETE' }).ok).toBe(false);
  });
});
