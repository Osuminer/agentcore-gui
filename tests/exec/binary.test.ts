import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { parseNpmCmdShim, resolveBinary } from '@/lib/exec/binary';

const SHIM = `@ECHO off
GOTO start
:start
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@aws\\agentcore\\dist\\cli\\index.mjs" %*
`;

describe('parseNpmCmdShim', () => {
  it('extracts the script path', () => {
    expect(parseNpmCmdShim(SHIM, 'C:\\npm')).toBe(path.join('C:\\npm', 'node_modules\\@aws\\agentcore\\dist\\cli\\index.mjs'));
  });
  it('returns null for an unrecognised shim', () => {
    expect(parseNpmCmdShim('@echo hi', 'C:\\npm')).toBeNull();
  });
});

describe('resolveBinary', () => {
  it('throws ENOENT for a missing binary', () => {
    expect(() => resolveBinary('definitely-not-installed-xyz', { PATH: os.tmpdir(), Path: os.tmpdir() }))
      .toThrowError(expect.objectContaining({ code: 'ENOENT' }));
  });
  it.runIf(process.platform === 'win32')('unwraps an npm .cmd shim to node + script', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-'));
    fs.mkdirSync(path.join(dir, 'node_modules/@aws/agentcore/dist/cli'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules/@aws/agentcore/dist/cli/index.mjs'), '');
    fs.writeFileSync(path.join(dir, 'fakecli.cmd'), SHIM);
    const r = resolveBinary('fakecli', { PATH: dir, Path: dir });
    expect(r.file).toBe(process.execPath);
    expect(r.prefixArgs[0]).toContain('index.mjs');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it.runIf(process.platform !== 'win32')('returns the bare name on POSIX', () => {
    expect(resolveBinary('agentcore')).toEqual({ file: 'agentcore', prefixArgs: [] });
  });
});
