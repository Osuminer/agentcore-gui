# AgentCore GUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A localhost-only Next.js app that renders an AWS Bedrock AgentCore project as an interactive React Flow graph and runs allowlisted `agentcore` / `aws` CLI commands with streamed logs.

**Architecture:** A pure config parser (`lib/config`) turns `agentcore/agentcore.json` (+ harness files) into a normalized `Graph`. A thin CLI adapter (`lib/cli`) owns the command allowlist, argv builders, spawn, and output parsers. Route handlers glue these together and stream via SSE; the React UI only consumes `Graph` and API JSON. A `MOCK=1` mode swaps the process executor and AWS identity for canned data.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind 3, `@xyflow/react` 12, `dagre`, Vitest. Node 22.

**Spec:** `docs/superpowers/specs/2026-10-12-agentcore-gui-design.md`

## Global Constraints

- Server binds to `127.0.0.1` only (`next dev|start -H 127.0.0.1 -p 4317`); requests with a non-localhost `Host`, or non-GET requests without a matching `Origin`, are rejected.
- Child processes use `child_process.spawn` with an argv array and `shell: false`; never `exec`.
- The browser never sends raw argv; it sends a command id + validated params from the allowlist.
- Read-only on project files: the app performs no writes inside the project directory (only the CLI may, via allowlisted commands). App-owned state lives in `~/.agentcore-gui/`.
- All project reads go through `lib/fs/safe-read.ts` (realpath-confined; rejects `..` and symlink/junction escapes). `.env*` files are never opened.
- Env var values and secret-looking fields are masked everywhere; only env var *names* reach the browser.
- Never read, store, log or display AWS tokens/credentials; pass `AWS_PROFILE` to child processes only; strip other `AWS_*` env vars from children. Streamed output is redacted.
- Always pass a `[non-interactive]` flag so the CLI never launches its TUI.
- v1 commands: `validate`, `status`, `package`, `deploy` (+`--diff`, `--dry-run`), `invoke`, `dev`, `logs`, `traces list`, and `create` (+ `--dry-run`). Excluded: `add`, `remove`, `import`, `archive`, `fetch access` (returns tokens), `traces get` (writes a file).
- `create` offers TypeScript only when `uv` is not detected.
- Layout engine: dagre. Out of scope: wizard, env/code editing, hosted deploy.

## Review Focus

Inputs the spec implies but no happy-path task would catch; each has a pinned test in the named task.

1. **Windows npm shims** (`agentcore.cmd` can't be spawned with `shell:false` on Node 22 → `EINVAL`): `resolveBinary` must unwrap the shim to `node …/index.mjs`, and a missing binary must yield a clear "not found" error, not a crash. (Task 6)
2. **Path escape**: `..` segments, absolute paths, symlink/junction pointing outside the project, and `.env.local` must all be rejected. (Task 2)
3. **Malformed project config**: invalid JSON, a section that isn't an array, items without `name`, unknown top-level keys, dangling references, duplicate names across types, same target name in two gateways → warnings and a partial graph, never an exception. (Tasks 3–4)
4. **Secrets in streamed output**: JWTs, `AKIA…` keys, `Bearer …` tokens and `aws_secret_access_key=…` in CLI stdout/stderr must be redacted before reaching the browser. (Task 6)
5. **Argument injection via params**: a name or prompt beginning with `-`, containing spaces/newlines/NUL, or an unknown param key must not alter the argv structure (values attached with `--flag=value` or validated as names). (Task 5)

---

## File Structure

```
package.json, tsconfig.json, next.config.mjs, postcss.config.mjs, tailwind.config.ts, vitest.config.ts, .gitignore
middleware.ts                         host/origin guard (calls lib/security/guard.ts)
app/layout.tsx, app/globals.css, app/page.tsx
app/api/prereqs/route.ts
app/api/aws/profiles/route.ts, whoami/route.ts, login/route.ts
app/api/project/open/route.ts, graph/route.ts, recent/route.ts, create-preview/route.ts (folded into run/preview)
app/api/run/route.ts, run/preview/route.ts, run/[id]/events/route.ts, run/[id]/route.ts
lib/security/guard.ts                 request guard (pure)
lib/fs/safe-read.ts                   resolveProjectRoot, safeReadText, PathEscapeError
lib/config/types.ts                   Graph model
lib/config/sanitize.ts                masking helpers
lib/config/parser.ts                  parseAgentCore (pure) 
lib/config/load.ts                    loadProject(root) -> Graph (reads files via safe-read)
lib/config/status.ts                  applyStatus(graph, status, validate)
lib/cli/parsers.ts                    parseStatusOutput, parseValidateOutput
lib/cli/catalog.ts                    command allowlist, fields, argv builders, validateParams, commandsForNode
lib/exec/binary.ts                    resolveBinary, parseNpmCmdShim
lib/exec/redact.ts                    redact()
lib/exec/run.ts                       Run class, registry, execReal, runToCompletion, childEnv
lib/exec/mock.ts                      mock executor + isMock()
lib/exec/index.ts                     startExec() chooses real/mock
lib/aws/config.ts                     parseAwsConfig, readProfiles
lib/aws/identity.ts                   getIdentity, classifyStsFailure, loginSpec, extractDeviceInfo
lib/store/recent.ts                   recent projects (app-owned file)
lib/server/http.ts                    json(), readJson(), handle()
lib/server/project.ts                 buildProjectGraph(), prereq detection
lib/ui/api.ts                         typed fetch helpers
components/theme.ts                   type colors, status styles, labels
components/AppShell.tsx, SsoBar.tsx, ProjectPicker.tsx
components/graph/layout.ts, GraphView.tsx, ResourceNode.tsx, Filters.tsx
components/NodePanel.tsx, RunDialog.tsx, CommandDrawer.tsx, useRunStream.ts
fixtures/demo-project/...             mock project (real files)
tests/**                              vitest tests mirroring lib/
README.md
```

---

### Task 1: Project scaffold, tooling, request guard

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `postcss.config.mjs`, `tailwind.config.ts`, `vitest.config.ts`, `.gitignore`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `middleware.ts`, `lib/security/guard.ts`
- Test: `tests/security/guard.test.ts`

**Interfaces:**
- Produces: `checkRequest(input: { host: string | null; origin: string | null; method: string }): { ok: true } | { ok: false; reason: string }`

- [ ] **Step 1: Initialise git and write config files**

```bash
cd c:/Users/creep/Documents/Programs/agentcore-gui
git init
```

`package.json`:
```json
{
  "name": "agentcore-gui",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -H 127.0.0.1 -p 4317",
    "dev:mock": "cross-env MOCK=1 next dev -H 127.0.0.1 -p 4317",
    "build": "next build",
    "start": "next start -H 127.0.0.1 -p 4317",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@xyflow/react": "^12.3.5",
    "dagre": "^0.8.5",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/dagre": "^0.7.52",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "cross-env": "^7.0.3",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.6.0",
    "vitest": "^2.1.8"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "fixtures"]
}
```

`next.config.mjs`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
export default nextConfig;
```

`postcss.config.mjs`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname) } },
});
```

`.gitignore`:
```
node_modules
.next
next-env.d.ts
*.tsbuildinfo
```

`app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
html, body { height: 100%; }
body { background: #0b1020; color: #e5e7eb; }
```

`app/layout.tsx`:
```tsx
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'AgentCore Graph' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`app/page.tsx` (placeholder replaced in Task 9):
```tsx
export default function Page() {
  return <main className="p-6">AgentCore Graph</main>;
}
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: completes without errors.

- [ ] **Step 3: Write the failing guard test**

`tests/security/guard.test.ts`:
```ts
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
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run tests/security/guard.test.ts`
Expected: FAIL (module `@/lib/security/guard` not found).

- [ ] **Step 5: Implement guard and middleware**

`lib/security/guard.ts`:
```ts
const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostnameOf(hostHeader: string): string {
  return hostHeader.replace(/:\d+$/, '').toLowerCase();
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

export function checkRequest(input: { host: string | null; origin: string | null; method: string }): GuardResult {
  if (!input.host) return { ok: false, reason: 'Missing Host header' };
  if (!ALLOWED_HOSTNAMES.has(hostnameOf(input.host))) {
    return { ok: false, reason: `Host '${input.host}' is not allowed` };
  }
  if (SAFE_METHODS.has(input.method.toUpperCase())) return { ok: true };
  if (!input.origin) return { ok: false, reason: 'Missing Origin header' };
  let originHost: string;
  try {
    originHost = new URL(input.origin).host.toLowerCase();
  } catch {
    return { ok: false, reason: 'Malformed Origin header' };
  }
  if (originHost !== input.host.toLowerCase()) {
    return { ok: false, reason: `Origin '${input.origin}' does not match Host` };
  }
  return { ok: true };
}
```

`middleware.ts`:
```ts
import { NextResponse, type NextRequest } from 'next/server';
import { checkRequest } from '@/lib/security/guard';

export function middleware(req: NextRequest) {
  const result = checkRequest({
    host: req.headers.get('host'),
    origin: req.headers.get('origin'),
    method: req.method,
  });
  if (!result.ok) return new NextResponse(`Forbidden: ${result.reason}`, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: '/((?!_next/static|_next/image|favicon.ico).*)' };
```

- [ ] **Step 6: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 9 tests PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with localhost request guard"
```

---

### Task 2: Graph types and path-confined reads

**Files:**
- Create: `lib/config/types.ts`, `lib/fs/safe-read.ts`
- Test: `tests/fs/safe-read.test.ts`

**Interfaces:**
- Produces (`lib/config/types.ts`): `NodeType`, `NodeStatus`, `GraphNode`, `GraphEdge`, `GraphWarning`, `Graph` (shapes below).
- Produces (`lib/fs/safe-read.ts`): `class PathEscapeError extends Error`; `resolveProjectRoot(p: string): Promise<string>` (realpath of a dir containing `agentcore/agentcore.json`, else throws `Error('Not an AgentCore project: …')`); `safeReadText(root: string, rel: string, opts?: { maxBytes?: number }): Promise<string>`.

- [ ] **Step 1: Write the types**

`lib/config/types.ts`:
```ts
export type NodeType =
  | 'runtime' | 'memory' | 'knowledgeBase' | 'credential' | 'evaluator' | 'onlineEval'
  | 'gateway' | 'gatewayTarget' | 'mcpRuntimeTool' | 'policyEngine' | 'policy'
  | 'configBundle' | 'abTest' | 'harness' | 'dataset' | 'capacityProvider'
  | 'paymentManager' | 'paymentConnector' | 'external' | 'other';

export type NodeStatus = 'not-deployed' | 'deployed' | 'pending-removal' | 'error' | 'unknown';

export interface GraphNode {
  id: string;                 // `${type}:${name}`; targets: `gatewayTarget:${gateway}/${name}`
  type: NodeType;
  name: string;
  status: NodeStatus;
  statusDetail?: string;
  config: Record<string, unknown>;   // sanitized
  envVarNames: string[];
  sourcePath?: string;        // project-relative
  warnings: string[];
  parent?: string;            // node id (target -> gateway)
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: 'declared' | 'inferred';
  label: string;
  source: string;             // where it came from, e.g. "agentCoreGateways[].targets[].httpRuntime"
}

export interface GraphWarning { scope: string; message: string }

export interface Graph {
  projectName: string;
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: GraphWarning[];
}
```

- [ ] **Step 2: Write the failing safe-read tests**

`tests/fs/safe-read.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PathEscapeError, resolveProjectRoot, safeReadText } from '@/lib/fs/safe-read';

let base: string;
let project: string;
let outside: string;
let linkWorks = true;

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'acgui-'));
  project = path.join(base, 'proj');
  outside = path.join(base, 'outside');
  await fs.mkdir(path.join(project, 'agentcore'), { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(project, 'agentcore', 'agentcore.json'), '{"name":"p"}');
  await fs.writeFile(path.join(project, 'agentcore', '.env.local'), 'SECRET=1');
  await fs.writeFile(path.join(outside, 'secret.txt'), 'top secret');
  try {
    await fs.symlink(outside, path.join(project, 'link'), 'junction');
  } catch {
    linkWorks = false;
  }
});
afterAll(async () => { await fs.rm(base, { recursive: true, force: true }); });

describe('resolveProjectRoot', () => {
  it('accepts a project directory', async () => {
    expect(await resolveProjectRoot(project)).toBe(await fs.realpath(project));
  });
  it('rejects a directory without agentcore/agentcore.json', async () => {
    await expect(resolveProjectRoot(outside)).rejects.toThrow(/Not an AgentCore project/);
  });
  it('rejects a missing path', async () => {
    await expect(resolveProjectRoot(path.join(base, 'nope'))).rejects.toThrow();
  });
});

describe('safeReadText', () => {
  it('reads a file inside the project', async () => {
    const root = await resolveProjectRoot(project);
    expect(await safeReadText(root, 'agentcore/agentcore.json')).toBe('{"name":"p"}');
  });
  it('rejects ../ traversal', async () => {
    const root = await resolveProjectRoot(project);
    await expect(safeReadText(root, '../outside/secret.txt')).rejects.toBeInstanceOf(PathEscapeError);
  });
  it('rejects nested traversal that normalises outside', async () => {
    const root = await resolveProjectRoot(project);
    await expect(safeReadText(root, 'agentcore/../../outside/secret.txt')).rejects.toBeInstanceOf(PathEscapeError);
  });
  it('rejects absolute paths', async () => {
    const root = await resolveProjectRoot(project);
    await expect(safeReadText(root, path.join(outside, 'secret.txt'))).rejects.toBeInstanceOf(PathEscapeError);
  });
  it('rejects a symlink/junction that points outside', async () => {
    if (!linkWorks) return;
    const root = await resolveProjectRoot(project);
    await expect(safeReadText(root, 'link/secret.txt')).rejects.toBeInstanceOf(PathEscapeError);
  });
  it('never reads .env files', async () => {
    const root = await resolveProjectRoot(project);
    await expect(safeReadText(root, 'agentcore/.env.local')).rejects.toBeInstanceOf(PathEscapeError);
  });
  it('enforces a size cap', async () => {
    const root = await resolveProjectRoot(project);
    await expect(safeReadText(root, 'agentcore/agentcore.json', { maxBytes: 3 })).rejects.toThrow(/too large/i);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/fs/safe-read.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement**

`lib/fs/safe-read.ts`:
```ts
import fs from 'node:fs/promises';
import path from 'node:path';

export class PathEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathEscapeError';
  }
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

export async function resolveProjectRoot(p: string): Promise<string> {
  if (typeof p !== 'string' || p.length === 0 || p.includes('\0')) throw new Error('Invalid project path');
  const real = await fs.realpath(path.resolve(p));
  const st = await fs.stat(real);
  if (!st.isDirectory()) throw new Error(`Not a directory: ${p}`);
  try {
    await fs.access(path.join(real, 'agentcore', 'agentcore.json'));
  } catch {
    throw new Error(`Not an AgentCore project: ${p} (missing agentcore/agentcore.json)`);
  }
  return real;
}

export async function safeReadText(root: string, rel: string, opts: { maxBytes?: number } = {}): Promise<string> {
  if (rel.includes('\0')) throw new PathEscapeError('Invalid path');
  if (path.isAbsolute(rel)) throw new PathEscapeError('Absolute paths are not allowed');
  const resolved = path.resolve(root, rel);
  if (!isInside(root, resolved)) throw new PathEscapeError(`Path escapes project: ${rel}`);
  if (/^\.env/i.test(path.basename(resolved))) throw new PathEscapeError('Environment files are never read');
  let real: string;
  try {
    real = await fs.realpath(resolved);
  } catch (e) {
    throw e;
  }
  if (!isInside(root, real)) throw new PathEscapeError(`Path resolves outside project: ${rel}`);
  const st = await fs.stat(real);
  const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  if (st.size > max) throw new Error(`File too large (${st.size} bytes, max ${max}): ${rel}`);
  return fs.readFile(real, 'utf8');
}
```

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/fs/safe-read.test.ts && npx tsc --noEmit`
Expected: all PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: graph types and path-confined file reads"
```

---

### Task 3: Fixture project and parser (nodes + declared edges)

**Files:**
- Create: `fixtures/demo-project/agentcore/agentcore.json`, `fixtures/demo-project/agentcore/aws-targets.json`, `fixtures/demo-project/app/support_h/harness.json`, `lib/config/sanitize.ts`, `lib/config/parser.ts`
- Test: `tests/config/parser.test.ts`

**Interfaces:**
- Consumes: types from Task 2.
- Produces: `isObj(v: unknown): v is Record<string, unknown>`, `sanitize(value: unknown, key?: string): unknown`, `MASK = '••••'` (`lib/config/sanitize.ts`); `nodeId(type: NodeType, name: string): string`, `parseAgentCore(input: { root: string; agentcore: unknown; harnesses: Record<string, unknown> }): Graph` (`lib/config/parser.ts`).

- [ ] **Step 1: Create the fixture (real files; also used by mock mode)**

`fixtures/demo-project/agentcore/agentcore.json`:
```json
{
  "$schema": "https://schema.agentcore.aws.dev/v1/agentcore.json",
  "name": "demo",
  "version": 1,
  "managedBy": "CDK",
  "runtimes": [
    {
      "name": "orders_agent", "build": "CodeZip", "entrypoint": "main.py", "codeLocation": "app/orders_agent/",
      "runtimeVersion": "PYTHON_3_12", "protocol": "HTTP",
      "envVars": [
        { "name": "ORDERS_API_KEY", "value": "sk-live-123" },
        { "name": "LOG_LEVEL", "value": "debug" }
      ],
      "connections": [
        { "to": { "type": "memory", "arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/ordersMemory-abc123" }, "access": "readwrite" },
        { "to": { "type": "gateway", "arn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:gateway/tools-gw-xyz" } },
        { "to": { "type": "browser" } }
      ]
    },
    {
      "name": "planner_agent", "build": "CodeZip", "entrypoint": "main.py", "codeLocation": "app/planner_agent/",
      "runtimeVersion": "PYTHON_3_12",
      "capacityProviderConfiguration": { "capacityProviderName": "pool1" }
    }
  ],
  "memories": [
    { "name": "ordersMemory", "eventExpiryDuration": 30, "strategies": [] },
    { "name": "planner_agentMemory", "eventExpiryDuration": 30, "strategies": [] }
  ],
  "knowledgeBases": [
    { "type": "AgentCoreKnowledgeBase", "name": "docs_kb", "dataSources": [{ "type": "S3", "uri": "s3://demo-docs/" }], "gateway": "tools-gw" }
  ],
  "credentials": [
    { "authorizerType": "OAuthCredentialProvider", "name": "crm_oauth", "vendor": "CustomOauth2", "clientSecret": "shh-do-not-show" }
  ],
  "evaluators": [
    {
      "name": "quality", "level": "SESSION",
      "config": { "llmAsAJudge": { "model": "anthropic.claude-3-5-sonnet-20240620-v1:0", "instructions": "Rate helpfulness", "ratingScale": { "categorical": [{ "label": "good", "definition": "helpful" }] } } }
    }
  ],
  "onlineEvalConfigs": [
    { "name": "orders_eval", "agent": "orders_agent", "evaluators": ["quality", "missing_eval"], "samplingRate": 10 }
  ],
  "agentCoreGateways": [
    {
      "name": "tools-gw", "protocolType": "None", "authorizerType": "NONE", "enableSemanticSearch": true, "exceptionLevel": "NONE",
      "policyEngineConfiguration": { "policyEngineName": "guardrails", "mode": "ENFORCE" },
      "targets": [
        { "name": "planner-target", "targetType": "httpRuntime", "httpRuntime": { "runtime": "planner_agent" } },
        { "name": "crm-mcp", "targetType": "mcpServer", "endpoint": "https://crm.example.com/mcp", "outboundAuth": { "type": "OAUTH", "credentialName": "crm_oauth" } },
        { "name": "kb-target", "targetType": "connector", "connectorId": "bedrock-knowledge-bases", "configurations": [{ "name": "kb", "parameterValues": { "knowledgeBaseId": "docs_kb" } }] }
      ]
    }
  ],
  "policyEngines": [
    { "name": "guardrails", "policies": [{ "name": "deny_refunds", "statement": "forbid(principal, action, resource);", "validationMode": "FAIL_ON_ANY_FINDINGS", "enforcementMode": "ACTIVE" }] }
  ],
  "configBundles": [],
  "abTests": [],
  "harnesses": [{ "name": "support_h", "path": "app/support_h" }],
  "datasets": [],
  "capacityProviders": [
    {
      "name": "pool1", "operatorRoleArn": "arn:aws:iam::123456789012:role/op",
      "computeConfiguration": { "ec2Configuration": {
        "launchTemplateSource": { "launchParameters": { "operatingSystem": "LINUX_ARM64", "instanceRequirements": { "allowedInstanceTypes": ["m7g.large"] } } },
        "vpcConfiguration": { "subnets": ["subnet-12345678"], "securityGroups": ["sg-12345678"] }
      } }
    }
  ],
  "payments": [],
  "futureThing": { "x": 1 }
}
```

`fixtures/demo-project/agentcore/aws-targets.json`:
```json
[{ "name": "default", "account": "123456789012", "region": "us-east-1" }]
```

`fixtures/demo-project/app/support_h/harness.json`:
```json
{
  "name": "support_h",
  "model": { "provider": "bedrock", "modelId": "anthropic.claude-3-5-sonnet-20240620-v1:0" },
  "tools": [
    { "type": "agentcore_gateway", "name": "gw", "gatewayArn": "arn:aws:bedrock-agentcore:us-east-1:123456789012:gateway/tools-gw-xyz" }
  ],
  "skills": [],
  "memory": { "mode": "existing", "name": "ordersMemory" }
}
```

- [ ] **Step 2: Write the failing tests (nodes, declared edges, masking, warnings)**

`tests/config/parser.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseAgentCore, nodeId } from '@/lib/config/parser';
import { MASK } from '@/lib/config/sanitize';
import type { Graph } from '@/lib/config/types';

const fx = path.join(__dirname, '../../fixtures/demo-project');
const agentcore = JSON.parse(fs.readFileSync(path.join(fx, 'agentcore/agentcore.json'), 'utf8'));
const harness = JSON.parse(fs.readFileSync(path.join(fx, 'app/support_h/harness.json'), 'utf8'));

function parse(over: Partial<{ agentcore: unknown; harnesses: Record<string, unknown> }> = {}): Graph {
  return parseAgentCore({ root: fx, agentcore: over.agentcore ?? agentcore, harnesses: over.harnesses ?? { support_h: harness } });
}
const hasEdge = (g: Graph, from: string, to: string, kind?: 'declared' | 'inferred') =>
  g.edges.some((e) => e.from === from && e.to === to && (!kind || e.kind === kind));

describe('nodes', () => {
  const g = parse();
  it('creates a node per resource across types', () => {
    expect(g.nodes.length).toBe(17);
    expect(g.projectName).toBe('demo');
    for (const id of ['runtime:orders_agent', 'memory:ordersMemory', 'gateway:tools-gw', 'gatewayTarget:tools-gw/crm-mcp',
      'policyEngine:guardrails', 'policy:guardrails/deny_refunds', 'harness:support_h', 'capacityProvider:pool1',
      'knowledgeBase:docs_kb', 'credential:crm_oauth', 'evaluator:quality', 'onlineEval:orders_eval']) {
      expect(g.nodes.some((n) => n.id === id), id).toBe(true);
    }
  });
  it('records env var names but masks their values', () => {
    const n = g.nodes.find((x) => x.id === 'runtime:orders_agent')!;
    expect(n.envVarNames).toEqual(['ORDERS_API_KEY', 'LOG_LEVEL']);
    expect(JSON.stringify(n.config)).not.toContain('sk-live-123');
    expect(JSON.stringify(n.config)).toContain(MASK);
  });
  it('masks secret-looking fields', () => {
    const n = g.nodes.find((x) => x.id === 'credential:crm_oauth')!;
    expect(JSON.stringify(n.config)).not.toContain('shh-do-not-show');
  });
  it('sets sourcePath for runtimes and harnesses', () => {
    expect(g.nodes.find((x) => x.id === 'runtime:orders_agent')!.sourcePath).toBe('app/orders_agent/');
    expect(g.nodes.find((x) => x.id === 'harness:support_h')!.sourcePath).toBe('app/support_h');
  });
  it('omits child collections from parent config', () => {
    const gw = g.nodes.find((x) => x.id === 'gateway:tools-gw')!;
    expect(gw.config).not.toHaveProperty('targets');
  });
});

describe('declared edges', () => {
  const g = parse();
  it.each([
    ['gateway:tools-gw', 'gatewayTarget:tools-gw/planner-target'],
    ['gatewayTarget:tools-gw/planner-target', 'runtime:planner_agent'],
    ['gatewayTarget:tools-gw/crm-mcp', 'credential:crm_oauth'],
    ['gateway:tools-gw', 'policyEngine:guardrails'],
    ['knowledgeBase:docs_kb', 'gateway:tools-gw'],
    ['runtime:planner_agent', 'capacityProvider:pool1'],
    ['policyEngine:guardrails', 'policy:guardrails/deny_refunds'],
    ['onlineEval:orders_eval', 'runtime:orders_agent'],
    ['onlineEval:orders_eval', 'evaluator:quality'],
    ['harness:support_h', 'memory:ordersMemory'],
  ])('%s -> %s', (from, to) => {
    expect(hasEdge(g, from, to, 'declared')).toBe(true);
  });
});

describe('warnings (never throw)', () => {
  it('warns on unknown top-level sections', () => {
    expect(parse().warnings.some((w) => /futureThing/.test(w.message))).toBe(true);
  });
  it('warns on dangling references', () => {
    expect(parse().warnings.some((w) => /missing_eval/.test(w.message))).toBe(true);
  });
  it('tolerates a non-object document', () => {
    const g = parse({ agentcore: 'nope' });
    expect(g.nodes).toEqual([]);
    expect(g.warnings.length).toBeGreaterThan(0);
  });
  it('tolerates a section that is not an array', () => {
    const g = parse({ agentcore: { name: 'x', runtimes: { oops: true } }, harnesses: {} });
    expect(g.warnings.some((w) => w.scope === 'runtimes')).toBe(true);
  });
  it('skips items without a name', () => {
    const g = parse({ agentcore: { name: 'x', runtimes: [{ build: 'CodeZip' }, { name: 'ok' }] }, harnesses: {} });
    expect(g.nodes.map((n) => n.id)).toEqual(['runtime:ok']);
    expect(g.warnings.some((w) => /without a name/.test(w.message))).toBe(true);
  });
  it('keeps same-named targets in different gateways distinct', () => {
    const t = { name: 't', targetType: 'mcpServer', endpoint: 'https://x' };
    const g = parse({ agentcore: { name: 'x', agentCoreGateways: [{ name: 'a', targets: [t] }, { name: 'b', targets: [t] }] }, harnesses: {} });
    expect(g.nodes.filter((n) => n.type === 'gatewayTarget').map((n) => n.id).sort()).toEqual(['gatewayTarget:a/t', 'gatewayTarget:b/t']);
  });
  it('uses the same name across types without collision', () => {
    const g = parse({ agentcore: { name: 'x', runtimes: [{ name: 'same' }], memories: [{ name: 'same' }] }, harnesses: {} });
    expect(new Set(g.nodes.map((n) => n.id)).size).toBe(2);
  });
  it('reports a harness whose file could not be loaded', () => {
    const g = parse({ harnesses: { support_h: { __error: 'File not found' } } });
    expect(g.warnings.some((w) => /support_h/.test(w.message) && /File not found/.test(w.message))).toBe(true);
    expect(g.nodes.some((n) => n.id === 'harness:support_h')).toBe(true);
  });
});

describe('nodeId', () => {
  it('namespaces by type', () => {
    expect(nodeId('runtime', 'a')).toBe('runtime:a');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/config/parser.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement sanitize**

`lib/config/sanitize.ts`:
```ts
export const MASK = '••••';
const SECRET_KEY = /(secret|password|passwd|token|apikey|api_key|api-key|private_?key)/i;

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function dig(v: unknown, ...keys: string[]): unknown {
  let cur: unknown = v;
  for (const k of keys) {
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Deep-clones `value`, masking env var values and string fields whose key looks secret. */
export function sanitize(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((v) => sanitize(v, key));
  if (isObj(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'envVars' && Array.isArray(v)) {
        out[k] = v.map((e) => (isObj(e) ? { ...e, value: MASK } : e));
      } else {
        out[k] = sanitize(v, k);
      }
    }
    return out;
  }
  if (typeof value === 'string' && SECRET_KEY.test(key)) return MASK;
  return value;
}
```

- [ ] **Step 5: Implement the parser (nodes + declared edges; inferred edges arrive in Task 4)**

`lib/config/parser.ts`:
```ts
import type { Graph, GraphEdge, GraphNode, GraphWarning, NodeType } from './types';
import { dig, isObj, sanitize, str } from './sanitize';

type Rec = Record<string, unknown>;

export const nodeId = (type: NodeType, name: string) => `${type}:${name}`;
const targetId = (gw: string | null, name: string) => `gatewayTarget:${gw ?? ''}/${name}`;
const policyId = (engine: string, name: string) => `policy:${engine}/${name}`;

const KNOWN_KEYS = new Set([
  '$schema', 'name', 'version', 'managedBy', 'tags', 'runtimes', 'memories', 'knowledgeBases', 'credentials',
  'evaluators', 'onlineEvalConfigs', 'agentCoreGateways', 'mcpRuntimeTools', 'unassignedTargets', 'policyEngines',
  'configBundles', 'abTests', 'harnesses', 'datasets', 'capacityProviders', 'payments',
]);

const SIMPLE: { key: string; type: NodeType }[] = [
  { key: 'runtimes', type: 'runtime' },
  { key: 'memories', type: 'memory' },
  { key: 'knowledgeBases', type: 'knowledgeBase' },
  { key: 'credentials', type: 'credential' },
  { key: 'evaluators', type: 'evaluator' },
  { key: 'onlineEvalConfigs', type: 'onlineEval' },
  { key: 'configBundles', type: 'configBundle' },
  { key: 'abTests', type: 'abTest' },
  { key: 'datasets', type: 'dataset' },
  { key: 'capacityProviders', type: 'capacityProvider' },
  { key: 'mcpRuntimeTools', type: 'mcpRuntimeTool' },
];

export class Builder {
  nodes = new Map<string, GraphNode>();
  edges = new Map<string, GraphEdge>();
  warnings: GraphWarning[] = [];

  warn(scope: string, message: string, nodeIdForNode?: string) {
    this.warnings.push({ scope, message });
    if (nodeIdForNode) this.nodes.get(nodeIdForNode)?.warnings.push(message);
  }

  add(type: NodeType, name: string, raw: Rec, opts: {
    id?: string; omit?: string[]; sourcePath?: string; envVarNames?: string[]; parent?: string;
  } = {}): string {
    const id = opts.id ?? nodeId(type, name);
    if (this.nodes.has(id)) { this.warn(type, `Duplicate ${type} '${name}' ignored`); return id; }
    const cfg: Rec = { ...raw };
    for (const k of opts.omit ?? []) delete cfg[k];
    this.nodes.set(id, {
      id, type, name, status: 'unknown', config: sanitize(cfg) as Rec,
      envVarNames: opts.envVarNames ?? [], sourcePath: opts.sourcePath, warnings: [], parent: opts.parent,
    });
    return id;
  }

  has(id: string) { return this.nodes.has(id); }

  link(from: string, to: string, kind: 'declared' | 'inferred', label: string, source: string) {
    const id = `${from}->${to}:${label}`;
    if (!this.edges.has(id)) this.edges.set(id, { id, from, to, kind, label, source });
  }

  /** Link `from` to the node `toId` if it exists, else warn about the dangling reference. */
  ref(from: string, toId: string, shown: string, label: string, source: string, kind: 'declared' | 'inferred' = 'declared') {
    if (!this.has(toId)) {
      this.warn(source, `${source}: references '${shown}' which is not defined in this project`, from);
      return;
    }
    this.link(from, toId, kind, label, source);
  }
}

function listOf(b: Builder, root: Rec, key: string): Rec[] {
  const v = root[key];
  if (v === undefined) return [];
  if (!Array.isArray(v)) { b.warn(key, `Expected an array, got ${typeof v}`); return []; }
  const out: Rec[] = [];
  v.forEach((item, i) => {
    if (!isObj(item)) { b.warn(key, `${key}[${i}] is not an object`); return; }
    if (!str(item.name)) { b.warn(key, `${key}[${i}] is an item without a name and was skipped`); return; }
    out.push(item);
  });
  return out;
}

function envNames(v: unknown): string[] {
  return Array.isArray(v) ? v.flatMap((e) => (isObj(e) && str(e.name) ? [e.name as string] : [])) : [];
}

function extras(type: NodeType, item: Rec) {
  switch (type) {
    case 'runtime': return { sourcePath: str(item.codeLocation), envVarNames: envNames(item.envVars) };
    case 'evaluator': return { sourcePath: str(dig(item, 'config', 'codeBased', 'managed', 'codeLocation')) };
    case 'mcpRuntimeTool': return { sourcePath: str(dig(item, 'compute', 'implementation', 'path')) };
    case 'dataset': return { sourcePath: str(dig(item, 'config', 'managed', 'location')) };
    default: return {};
  }
}

function addTargets(b: Builder, gw: string | null, targets: unknown, gwNodeId?: string) {
  if (!Array.isArray(targets)) return;
  targets.forEach((t, i) => {
    if (!isObj(t) || !str(t.name)) { b.warn('targets', `${gw ?? 'unassigned'}.targets[${i}] is missing a name`); return; }
    const name = t.name as string;
    const id = b.add('gatewayTarget', name, t, {
      id: targetId(gw, name), parent: gwNodeId, sourcePath: str(dig(t, 'compute', 'implementation', 'path')),
    });
    if (gwNodeId) b.link(gwNodeId, id, 'declared', 'target', 'agentCoreGateways[].targets');
  });
}

export function parseAgentCore(input: { root: string; agentcore: unknown; harnesses: Record<string, unknown> }): Graph {
  const b = new Builder();
  const doc = input.agentcore;
  const finish = (name: string): Graph => ({
    projectName: name, root: input.root, nodes: [...b.nodes.values()], edges: [...b.edges.values()], warnings: b.warnings,
  });
  if (!isObj(doc)) { b.warn('agentcore.json', 'Top-level value is not an object'); return finish('(unknown)'); }
  for (const k of Object.keys(doc)) {
    if (!KNOWN_KEYS.has(k)) b.warn(k, `Unrecognized section '${k}' (not rendered)`);
  }

  // ---- pass 1: nodes ----
  for (const { key, type } of SIMPLE) {
    for (const item of listOf(b, doc, key)) b.add(type, item.name as string, item, extras(type, item));
  }
  for (const gw of listOf(b, doc, 'agentCoreGateways')) {
    const gid = b.add('gateway', gw.name as string, gw, { omit: ['targets'] });
    addTargets(b, gw.name as string, gw.targets, gid);
  }
  addTargets(b, null, doc.unassignedTargets);
  for (const pe of listOf(b, doc, 'policyEngines')) {
    const eid = b.add('policyEngine', pe.name as string, pe, { omit: ['policies'] });
    if (Array.isArray(pe.policies)) {
      for (const p of pe.policies) {
        if (!isObj(p) || !str(p.name)) { b.warn('policyEngines', `${pe.name}.policies has an item without a name`); continue; }
        const pid = b.add('policy', p.name as string, p, { id: policyId(pe.name as string, p.name as string), parent: eid, sourcePath: str(p.sourceFile) });
        b.link(eid, pid, 'declared', 'policy', 'policyEngines[].policies');
      }
    }
  }
  for (const pm of listOf(b, doc, 'payments')) {
    const mid = b.add('paymentManager', pm.name as string, pm, { omit: ['connectors'] });
    if (Array.isArray(pm.connectors)) {
      for (const c of pm.connectors) {
        if (!isObj(c) || !str(c.name)) { b.warn('payments', `${pm.name}.connectors has an item without a name`); continue; }
        const cid = b.add('paymentConnector', c.name as string, c, { id: `paymentConnector:${pm.name}/${c.name}`, parent: mid });
        b.link(mid, cid, 'declared', 'connector', 'payments[].connectors');
        if (str(c.credentialName)) b.ref(cid, nodeId('credential', c.credentialName as string), c.credentialName as string, 'credential', 'payments[].connectors.credentialName');
      }
    }
  }
  for (const h of listOf(b, doc, 'harnesses')) {
    const name = h.name as string;
    const hc = input.harnesses[name];
    const id = b.add('harness', name, isObj(hc) && !('__error' in hc) ? { ...hc, path: h.path } : { path: h.path }, {
      sourcePath: str(h.path), envVarNames: isObj(hc) && isObj(hc.env) ? Object.keys(hc.env) : [],
    });
    if (isObj(hc) && typeof hc.__error === 'string') b.warn('harnesses', `Harness '${name}' could not be loaded: ${hc.__error}`, id);
    else if (hc === undefined) b.warn('harnesses', `Harness '${name}' has no harness.json loaded`, id);
  }

  // ---- pass 2: declared edges ----
  for (const gw of listOf(b, doc, 'agentCoreGateways')) {
    const gid = nodeId('gateway', gw.name as string);
    const pe = str(dig(gw, 'policyEngineConfiguration', 'policyEngineName'));
    if (pe) b.ref(gid, nodeId('policyEngine', pe), pe, 'policy engine', 'agentCoreGateways[].policyEngineConfiguration');
    linkTargets(b, gw.name as string, gw.targets);
  }
  linkTargets(b, null, doc.unassignedTargets);
  for (const kb of listOf(b, doc, 'knowledgeBases')) {
    if (str(kb.gateway)) b.ref(nodeId('knowledgeBase', kb.name as string), nodeId('gateway', kb.gateway as string), kb.gateway as string, 'gateway', 'knowledgeBases[].gateway');
  }
  for (const rt of listOf(b, doc, 'runtimes')) {
    const cp = str(dig(rt, 'capacityProviderConfiguration', 'capacityProviderName'));
    if (cp) b.ref(nodeId('runtime', rt.name as string), nodeId('capacityProvider', cp), cp, 'capacity provider', 'runtimes[].capacityProviderConfiguration');
  }
  for (const oe of listOf(b, doc, 'onlineEvalConfigs')) {
    const id = nodeId('onlineEval', oe.name as string);
    if (str(oe.agent)) b.ref(id, nodeId('runtime', oe.agent as string), oe.agent as string, str(oe.endpoint) ? `agent (${oe.endpoint})` : 'agent', 'onlineEvalConfigs[].agent');
    for (const ev of Array.isArray(oe.evaluators) ? oe.evaluators : []) {
      if (typeof ev === 'string') b.ref(id, nodeId('evaluator', ev), ev, 'evaluator', 'onlineEvalConfigs[].evaluators');
    }
  }
  for (const t of listOf(b, doc, 'mcpRuntimeTools')) {
    const id = nodeId('mcpRuntimeTool', t.name as string);
    for (const bind of Array.isArray(t.bindings) ? t.bindings : []) {
      if (isObj(bind) && str(bind.runtimeName)) b.ref(id, nodeId('runtime', bind.runtimeName as string), bind.runtimeName as string, 'binding', 'mcpRuntimeTools[].bindings');
    }
  }
  for (const ab of listOf(b, doc, 'abTests')) {
    const id = nodeId('abTest', ab.name as string);
    if (str(ab.gatewayRef)) b.ref(id, nodeId('gateway', ab.gatewayRef as string), ab.gatewayRef as string, 'gateway', 'abTests[].gatewayRef');
    for (const v of Array.isArray(ab.variants) ? ab.variants : []) {
      const tn = str(dig(v, 'variantConfiguration', 'target', 'targetName'));
      if (!tn) continue;
      const matches = [...b.nodes.values()].filter((n) => n.type === 'gatewayTarget' && n.name === tn);
      if (matches.length === 0) b.warn('abTests', `abTests[].variants references target '${tn}' which is not defined`, id);
      for (const m of matches) b.link(id, m.id, matches.length === 1 ? 'declared' : 'inferred', 'variant target', 'abTests[].variants');
    }
  }
  const g = finish(str(doc.name) ?? '(unnamed)');
  inferEdges(b, doc, input.harnesses);
  return finish(g.projectName);
}

function linkTargets(b: Builder, gw: string | null, targets: unknown) {
  if (!Array.isArray(targets)) return;
  for (const t of targets) {
    if (!isObj(t) || !str(t.name)) continue;
    const id = targetId(gw, t.name as string);
    const rt = str(dig(t, 'httpRuntime', 'runtime'));
    if (rt) {
      const ep = str(dig(t, 'httpRuntime', 'runtimeEndpoint'));
      b.ref(id, nodeId('runtime', rt), rt, ep ? `runtime (${ep})` : 'runtime', 'agentCoreGateways[].targets[].httpRuntime');
    }
    const cred = str(dig(t, 'outboundAuth', 'credentialName'));
    if (cred) b.ref(id, nodeId('credential', cred), cred, 'credential', 'agentCoreGateways[].targets[].outboundAuth');
  }
}

/** Implemented in Task 4. */
export function inferEdges(_b: Builder, _doc: Rec, _harnesses: Record<string, unknown>): void {}
```

- [ ] **Step 6: Verify**

Run: `npx vitest run tests/config && npx tsc --noEmit`
Expected: all PASS; typecheck clean. (If the node count assertion fails, print `g.nodes.map(n=>n.id)` and reconcile against the fixture; the fixture is the source of truth, expected 17 = 2 runtimes + 2 memories + 1 capacity provider + 1 credential + 1 KB + 1 gateway + 3 targets + 1 policy engine + 1 policy + 1 harness + 1 online eval + 1 evaluator + 1 external — the external node arrives in Task 4, so **temporarily this task yields 16**; change the test expectation to `toBeGreaterThanOrEqual(16)` here and tighten it to `17` in Task 4 Step 2.)

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: config parser with nodes, declared edges, masking and warnings"
```

---

### Task 4: Inferred edges, project loader, status merge

**Files:**
- Modify: `lib/config/parser.ts` (replace the `inferEdges` stub), `tests/config/parser.test.ts`
- Create: `lib/config/load.ts`, `lib/config/status.ts`, `lib/cli/parsers.ts`
- Test: `tests/config/inferred.test.ts`, `tests/config/load.test.ts`, `tests/config/status.test.ts`, `tests/cli/parsers.test.ts`

**Interfaces:**
- Consumes: `Builder`, `nodeId`, `parseAgentCore` (Task 3); `safeReadText`, `resolveProjectRoot` (Task 2).
- Produces:
  - `loadProject(root: string): Promise<Graph>` (`lib/config/load.ts`) — root must already be resolved via `resolveProjectRoot`.
  - `StatusResource = { resourceType: string; name: string; deploymentState: 'deployed' | 'local-only' | 'pending-removal' | string; detail?: string }`
  - `parseStatusOutput(stdout: string): { ok: true; resources: StatusResource[] } | { ok: false; error: string }`
  - `parseValidateOutput(stdout: string, code: number | null): { ok: true } | { ok: false; error: string }`
  - `applyStatus(graph: Graph, status: StatusResource[] | null, validate: { ok: true } | { ok: false; error: string } | null): Graph`

- [ ] **Step 1: Write failing tests for inferred edges**

`tests/config/inferred.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseAgentCore } from '@/lib/config/parser';
import type { Graph } from '@/lib/config/types';

const fx = path.join(__dirname, '../../fixtures/demo-project');
const agentcore = JSON.parse(fs.readFileSync(path.join(fx, 'agentcore/agentcore.json'), 'utf8'));
const harness = JSON.parse(fs.readFileSync(path.join(fx, 'app/support_h/harness.json'), 'utf8'));
const g: Graph = parseAgentCore({ root: fx, agentcore, harnesses: { support_h: harness } });
const edge = (from: string, to: string) => g.edges.find((e) => e.from === from && e.to === to);

describe('inferred edges', () => {
  it('connection ARN -> project memory is inferred', () => {
    expect(edge('runtime:orders_agent', 'memory:ordersMemory')?.kind).toBe('inferred');
  });
  it('connection ARN -> project gateway is inferred', () => {
    expect(edge('runtime:orders_agent', 'gateway:tools-gw')?.kind).toBe('inferred');
  });
  it('connection without ARN becomes an external node with a declared edge', () => {
    expect(g.nodes.some((n) => n.id === 'external:browser')).toBe(true);
    expect(edge('runtime:orders_agent', 'external:browser')?.kind).toBe('declared');
  });
  it('runtime -> <runtime>Memory by naming convention is inferred', () => {
    expect(edge('runtime:planner_agent', 'memory:planner_agentMemory')?.kind).toBe('inferred');
  });
  it('does not add a convention edge when the memory is already linked', () => {
    const g2 = parseAgentCore({
      root: fx, harnesses: {},
      agentcore: { name: 'x', runtimes: [{ name: 'a', connections: [{ to: { type: 'memory', arn: 'arn:aws:x:r:1:memory/aMemory-1' } }] }], memories: [{ name: 'aMemory' }] },
    });
    expect(g2.edges.filter((e) => e.from === 'runtime:a' && e.to === 'memory:aMemory')).toHaveLength(1);
  });
  it('harness gateway tool ARN -> gateway is inferred', () => {
    expect(edge('harness:support_h', 'gateway:tools-gw')?.kind).toBe('inferred');
  });
  it('connector knowledge base reference -> KB is inferred', () => {
    expect(edge('gatewayTarget:tools-gw/kb-target', 'knowledgeBase:docs_kb')?.kind).toBe('inferred');
  });
  it('ARN matching prefers the longest name and requires a boundary', () => {
    const g3 = parseAgentCore({
      root: fx, harnesses: {},
      agentcore: { name: 'x', runtimes: [{ name: 'r', connections: [{ to: { type: 'gateway', arn: 'arn:aws:x:r:1:gateway/gw10-abc' } }] }],
        agentCoreGateways: [{ name: 'gw1', targets: [] }, { name: 'gw10', targets: [] }] },
    });
    expect(g3.edges.some((e) => e.from === 'runtime:r' && e.to === 'gateway:gw10')).toBe(true);
    expect(g3.edges.some((e) => e.from === 'runtime:r' && e.to === 'gateway:gw1')).toBe(false);
  });
});
```
In `tests/config/parser.test.ts` change the node count assertion back to `toBe(17)`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/config`
Expected: inferred tests FAIL; the count test FAILs (16 ≠ 17).

- [ ] **Step 3: Implement `inferEdges`**

Replace the stub at the bottom of `lib/config/parser.ts` with:
```ts
function matchByArn(b: Builder, type: NodeType, arn: string): string | null {
  const seg = arn.split(/[/:]/).filter(Boolean).pop() ?? '';
  let best: GraphNode | undefined;
  for (const n of b.nodes.values()) {
    if (n.type !== type) continue;
    if (seg === n.name || seg.startsWith(n.name + '-')) {
      if (!best || n.name.length > best.name.length) best = n;
    }
  }
  return best?.id ?? null;
}

function externalNode(b: Builder, kind: string, arn: string | undefined): string {
  const key = arn ?? kind;
  const id = `external:${key}`;
  if (!b.has(id)) b.add('external', arn ? `${kind} (external)` : kind, { type: kind, arn }, { id });
  return id;
}

const CONNECTION_TYPES: Record<string, NodeType> = { memory: 'memory', gateway: 'gateway', runtime: 'runtime' };

export function inferEdges(b: Builder, doc: Rec, harnesses: Record<string, unknown>): void {
  const runtimes = Array.isArray(doc.runtimes) ? doc.runtimes : [];
  for (const rt of runtimes) {
    if (!isObj(rt) || !str(rt.name)) continue;
    const from = nodeId('runtime', rt.name as string);
    for (const c of Array.isArray(rt.connections) ? rt.connections : []) {
      if (!isObj(c) || !isObj(c.to) || !str(c.to.type)) continue;
      const kind = c.to.type as string;
      const arn = str(c.to.arn);
      const label = str(c.id) ?? kind;
      const nodeType = CONNECTION_TYPES[kind];
      const matched = nodeType && arn ? matchByArn(b, nodeType, arn) : null;
      if (matched) b.link(from, matched, 'inferred', label, 'runtimes[].connections (ARN matched to project resource)');
      else b.link(from, externalNode(b, kind, arn), 'declared', label, 'runtimes[].connections');
    }
    // naming convention: <runtime>Memory
    const memId = nodeId('memory', `${rt.name}Memory`);
    const alreadyLinked = [...b.edges.values()].some((e) => e.from === from && e.to === memId);
    if (b.has(memId) && !alreadyLinked) b.link(from, memId, 'inferred', 'memory (by name)', 'naming convention <runtime>Memory');
  }

  for (const [name, hc] of Object.entries(harnesses)) {
    const from = nodeId('harness', name);
    if (!isObj(hc)) continue;
    if (isObj(hc.memory) && str(hc.memory.name) && hc.memory.mode !== 'disabled') {
      b.ref(from, nodeId('memory', hc.memory.name as string), hc.memory.name as string, 'memory', 'harness.json memory.name');
    }
    for (const t of Array.isArray(hc.tools) ? hc.tools : []) {
      if (isObj(t) && t.type === 'agentcore_gateway' && str(t.gatewayArn)) {
        const m = matchByArn(b, 'gateway', t.gatewayArn as string);
        if (m) b.link(from, m, 'inferred', 'gateway tool', 'harness.json tools[].gatewayArn (ARN matched)');
      }
    }
  }

  // connector targets that mention a project KB by name
  const kbNames = new Set([...b.nodes.values()].filter((n) => n.type === 'knowledgeBase').map((n) => n.name));
  for (const n of b.nodes.values()) {
    if (n.type !== 'gatewayTarget' || n.config.connectorId !== 'bedrock-knowledge-bases') continue;
    const cfgs = Array.isArray(n.config.configurations) ? n.config.configurations : [];
    for (const c of cfgs) {
      const pv = isObj(c) && isObj(c.parameterValues) ? c.parameterValues : {};
      for (const v of Object.values(pv)) {
        if (typeof v === 'string' && kbNames.has(v)) b.link(n.id, nodeId('knowledgeBase', v), 'inferred', 'knowledge base', 'connector configurations[].parameterValues');
      }
    }
  }
}
```
The `parseAgentCore` body already calls `inferEdges(b, doc, input.harnesses)` before the final `finish`, and the harness→memory declared edge now comes from `inferEdges`. Remove the now-redundant `export function inferEdges(_b…` stub.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/config && npx tsc --noEmit`
Expected: PASS (count = 17: the external browser node now exists).

- [ ] **Step 5: Write failing tests for parsers/loader/status**

`tests/cli/parsers.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseStatusOutput, parseValidateOutput } from '@/lib/cli/parsers';

describe('parseStatusOutput', () => {
  it('parses the --json shape', () => {
    const out = JSON.stringify({ success: true, resources: [{ resourceType: 'agent', name: 'a', deploymentState: 'local-only' }] });
    expect(parseStatusOutput(out)).toEqual({ ok: true, resources: [{ resourceType: 'agent', name: 'a', deploymentState: 'local-only' }] });
  });
  it('tolerates log noise around the JSON', () => {
    const out = 'Loading...\n' + JSON.stringify({ success: true, resources: [] }) + '\nDone\n';
    expect(parseStatusOutput(out)).toEqual({ ok: true, resources: [] });
  });
  it('reports success:false', () => {
    expect(parseStatusOutput(JSON.stringify({ success: false, error: 'boom' }))).toEqual({ ok: false, error: 'boom' });
  });
  it('reports non-JSON output', () => {
    expect(parseStatusOutput('garbage').ok).toBe(false);
  });
  it('drops malformed resource entries', () => {
    const out = JSON.stringify({ success: true, resources: [{ name: 'x' }, { resourceType: 'agent', name: 'a', deploymentState: 'deployed' }] });
    const r = parseStatusOutput(out);
    expect(r.ok && r.resources.length).toBe(1);
  });
});

describe('parseValidateOutput', () => {
  it('ok', () => expect(parseValidateOutput('{"success":true}', 0)).toEqual({ ok: true }));
  it('error message', () => {
    expect(parseValidateOutput('{"success":false,"error":"bad gateway"}', 1)).toEqual({ ok: false, error: 'bad gateway' });
  });
  it('non-JSON non-zero exit', () => {
    const r = parseValidateOutput('something broke', 1);
    expect(r.ok).toBe(false);
  });
});
```

`tests/config/status.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { applyStatus } from '@/lib/config/status';
import type { Graph } from '@/lib/config/types';

const base = (): Graph => ({
  projectName: 'p', root: '/p', warnings: [], edges: [],
  nodes: [
    { id: 'runtime:a', type: 'runtime', name: 'a', status: 'unknown', config: {}, envVarNames: [], warnings: [] },
    { id: 'gateway:g', type: 'gateway', name: 'g', status: 'unknown', config: {}, envVarNames: [], warnings: [] },
    { id: 'gatewayTarget:g/t', type: 'gatewayTarget', name: 't', status: 'unknown', config: {}, envVarNames: [], warnings: [], parent: 'gateway:g' },
    { id: 'memory:m', type: 'memory', name: 'm', status: 'unknown', config: {}, envVarNames: [], warnings: [] },
  ],
});
const byId = (g: Graph, id: string) => g.nodes.find((n) => n.id === id)!;

describe('applyStatus', () => {
  it('maps deployment states', () => {
    const g = applyStatus(base(), [
      { resourceType: 'agent', name: 'a', deploymentState: 'deployed' },
      { resourceType: 'gateway', name: 'g', deploymentState: 'local-only', detail: '1 target' },
      { resourceType: 'memory', name: 'm', deploymentState: 'pending-removal' },
    ], { ok: true });
    expect(byId(g, 'runtime:a').status).toBe('deployed');
    expect(byId(g, 'gateway:g').status).toBe('not-deployed');
    expect(byId(g, 'gateway:g').statusDetail).toBe('1 target');
    expect(byId(g, 'memory:m').status).toBe('pending-removal');
  });
  it('targets inherit their gateway status', () => {
    const g = applyStatus(base(), [{ resourceType: 'gateway', name: 'g', deploymentState: 'deployed' }], null);
    expect(byId(g, 'gatewayTarget:g/t').status).toBe('deployed');
  });
  it('leaves nodes unknown when status is null', () => {
    expect(byId(applyStatus(base(), null, null), 'runtime:a').status).toBe('unknown');
  });
  it('marks nodes named in a validate error as error and adds a warning', () => {
    const g = applyStatus(base(), [], { ok: false, error: 'agentCoreGateways[0]: Target "t" is bad' });
    expect(byId(g, 'gatewayTarget:g/t').status).toBe('error');
    expect(g.warnings.some((w) => w.scope === 'validate')).toBe(true);
  });
  it('does not mutate the input graph', () => {
    const input = base();
    applyStatus(input, [{ resourceType: 'agent', name: 'a', deploymentState: 'deployed' }], null);
    expect(byId(input, 'runtime:a').status).toBe('unknown');
  });
});
```

`tests/config/load.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { loadProject } from '@/lib/config/load';
import { resolveProjectRoot } from '@/lib/fs/safe-read';

const fx = path.join(__dirname, '../../fixtures/demo-project');

describe('loadProject', () => {
  it('loads the fixture including its harness', async () => {
    const g = await loadProject(await resolveProjectRoot(fx));
    expect(g.projectName).toBe('demo');
    expect(g.nodes.some((n) => n.id === 'harness:support_h')).toBe(true);
    expect(g.edges.some((e) => e.from === 'harness:support_h' && e.to === 'memory:ordersMemory')).toBe(true);
  });
  it('turns invalid JSON into a warning, not a throw', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acgui-bad-'));
    await fs.mkdir(path.join(dir, 'agentcore'));
    await fs.writeFile(path.join(dir, 'agentcore', 'agentcore.json'), '{ not json');
    const g = await loadProject(await resolveProjectRoot(dir));
    expect(g.nodes).toEqual([]);
    expect(g.warnings.some((w) => /agentcore\.json/.test(w.scope))).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });
  it('does not follow a harness path that escapes the project', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acgui-esc-'));
    await fs.mkdir(path.join(dir, 'agentcore'));
    await fs.writeFile(path.join(dir, 'agentcore', 'agentcore.json'),
      JSON.stringify({ name: 'x', harnesses: [{ name: 'h', path: '../../etc' }] }));
    const g = await loadProject(await resolveProjectRoot(dir));
    expect(g.warnings.some((w) => /h/.test(w.message) && /escape|outside/i.test(w.message))).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run tests/cli tests/config/status.test.ts tests/config/load.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 7: Implement parsers, status, loader**

`lib/cli/parsers.ts`:
```ts
export interface StatusResource {
  resourceType: string;
  name: string;
  deploymentState: string;
  detail?: string;
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON object found in output');
  return JSON.parse(text.slice(start, end + 1));
}

export function parseStatusOutput(stdout: string):
  { ok: true; resources: StatusResource[] } | { ok: false; error: string } {
  let data: unknown;
  try { data = extractJson(stdout); } catch (e) { return { ok: false, error: `Could not parse status output: ${(e as Error).message}` }; }
  const d = data as { success?: boolean; error?: string; resources?: unknown };
  if (d.success === false) return { ok: false, error: d.error ?? 'status failed' };
  if (!Array.isArray(d.resources)) return { ok: false, error: 'status output has no resources array' };
  const resources: StatusResource[] = [];
  for (const r of d.resources) {
    const o = r as Record<string, unknown>;
    if (typeof o?.resourceType === 'string' && typeof o?.name === 'string' && typeof o?.deploymentState === 'string') {
      resources.push({ resourceType: o.resourceType, name: o.name, deploymentState: o.deploymentState, detail: typeof o.detail === 'string' ? o.detail : undefined });
    }
  }
  return { ok: true, resources };
}

export function parseValidateOutput(stdout: string, code: number | null):
  { ok: true } | { ok: false; error: string } {
  try {
    const d = extractJson(stdout) as { success?: boolean; error?: string };
    if (d.success === true) return { ok: true };
    return { ok: false, error: d.error ?? 'validation failed' };
  } catch {
    return code === 0 ? { ok: true } : { ok: false, error: stdout.trim().slice(0, 2000) || `validate exited with code ${code}` };
  }
}
```

`lib/config/status.ts`:
```ts
import type { Graph, GraphNode, NodeStatus, NodeType } from './types';
import type { StatusResource } from '@/lib/cli/parsers';

const TYPE_MAP: Record<string, NodeType> = {
  agent: 'runtime', memory: 'memory', credential: 'credential', gateway: 'gateway', evaluator: 'evaluator',
  'online-eval': 'onlineEval', payment: 'paymentManager', 'policy-engine': 'policyEngine', policy: 'policy',
  'config-bundle': 'configBundle', dataset: 'dataset', 'knowledge-base': 'knowledgeBase', harness: 'harness',
  'capacity-provider': 'capacityProvider',
};

function mapState(s: string): NodeStatus {
  if (s === 'deployed') return 'deployed';
  if (s === 'local-only') return 'not-deployed';
  if (s === 'pending-removal') return 'pending-removal';
  return 'unknown';
}

export function applyStatus(
  graph: Graph,
  status: StatusResource[] | null,
  validate: { ok: true } | { ok: false; error: string } | null,
): Graph {
  const nodes: GraphNode[] = graph.nodes.map((n) => ({ ...n, warnings: [...n.warnings] }));
  const warnings = [...graph.warnings];

  if (status) {
    for (const r of status) {
      const type = TYPE_MAP[r.resourceType];
      if (!type) continue;
      const node = nodes.find((n) => n.type === type && n.name === r.name);
      if (node) { node.status = mapState(r.deploymentState); node.statusDetail = r.detail; }
    }
    for (const n of nodes) {
      if (n.type === 'gatewayTarget' && n.parent) {
        const gw = nodes.find((x) => x.id === n.parent);
        if (gw) n.status = gw.status;
      }
    }
  }

  if (validate && !validate.ok) {
    warnings.push({ scope: 'validate', message: validate.error });
    for (const n of nodes) {
      if (validate.error.includes(`"${n.name}"`) || validate.error.includes(`'${n.name}'`)) {
        n.status = 'error';
        n.warnings.push(validate.error);
      }
    }
  }
  return { ...graph, nodes, warnings };
}
```

`lib/config/load.ts`:
```ts
import { safeReadText } from '@/lib/fs/safe-read';
import { parseAgentCore } from './parser';
import type { Graph } from './types';

export async function loadProject(root: string): Promise<Graph> {
  let agentcore: unknown;
  try {
    agentcore = JSON.parse(await safeReadText(root, 'agentcore/agentcore.json'));
  } catch (e) {
    return {
      projectName: '(unreadable)', root, nodes: [], edges: [],
      warnings: [{ scope: 'agentcore.json', message: `Could not read or parse agentcore/agentcore.json: ${(e as Error).message}` }],
    };
  }
  const harnesses: Record<string, unknown> = {};
  const list = (agentcore as { harnesses?: unknown })?.harnesses;
  if (Array.isArray(list)) {
    for (const h of list) {
      const name = (h as { name?: unknown })?.name;
      const p = (h as { path?: unknown })?.path;
      if (typeof name !== 'string') continue;
      if (typeof p !== 'string') { harnesses[name] = { __error: 'harness has no path' }; continue; }
      try {
        harnesses[name] = JSON.parse(await safeReadText(root, `${p.replace(/\/+$/, '')}/harness.json`));
      } catch (e) {
        harnesses[name] = { __error: (e as Error).message };
      }
    }
  }
  return parseAgentCore({ root, agentcore, harnesses });
}
```

- [ ] **Step 8: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: inferred edges, project loader, status/validate merge"
```

---

### Task 5: CLI command catalog and parameter validation

**Files:**
- Create: `lib/cli/catalog.ts`
- Test: `tests/cli/catalog.test.ts`

**Interfaces:**
- Consumes: `GraphNode` (Task 2).
- Produces:
```ts
export type CommandId = 'validate' | 'status' | 'package' | 'deploy' | 'deployDiff' | 'deployDryRun'
  | 'invoke' | 'invokeHarness' | 'dev' | 'logs' | 'tracesList' | 'create' | 'createDryRun';
export interface FieldDef { key: string; label: string; required: boolean; kind: 'name' | 'text' | 'path' | 'enum'; options?: string[] }
export interface CommandSpec {
  id: CommandId; label: string; description: string;
  tool: 'agentcore';
  touchesAws: boolean; longRunning: boolean; cwd: 'project' | 'outputDir';
  fields: FieldDef[];
  build(p: Record<string, string>): string[];     // argv AFTER the executable
}
export const COMMANDS: Record<CommandId, CommandSpec>;
export class ParamError extends Error {}
export function isCommandId(v: unknown): v is CommandId;
export function validateParams(spec: CommandSpec, params: unknown): Record<string, string>;  // throws ParamError
export function displayCommand(file: string, args: string[]): string;                       // shell-quoted display string
export function commandsForNode(n: Pick<GraphNode, 'type' | 'name'>): { id: CommandId; params: Record<string, string> }[];
```

- [ ] **Step 1: Write failing tests**

`tests/cli/catalog.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { COMMANDS, ParamError, commandsForNode, displayCommand, isCommandId, validateParams } from '@/lib/cli/catalog';

const argv = (id: keyof typeof COMMANDS, p: Record<string, string> = {}) => COMMANDS[id].build(validateParams(COMMANDS[id], p));

describe('argv builders', () => {
  it('validate/status always pass --json (non-interactive)', () => {
    expect(argv('validate')).toEqual(['validate', '--json']);
    expect(argv('status')).toEqual(['status', '--json']);
  });
  it('deploy variants', () => {
    expect(argv('deploy')).toEqual(['deploy', '--yes', '--json', '-v']);
    expect(argv('deployDiff')).toEqual(['deploy', '--diff', '--json']);
    expect(argv('deployDryRun')).toEqual(['deploy', '--dry-run', '--json']);
  });
  it('invoke attaches the prompt with = so it can never become a flag', () => {
    expect(argv('invoke', { prompt: '--runtime evil', runtime: 'orders_agent' }))
      .toEqual(['invoke', '--prompt=--runtime evil', '--stream', '--runtime', 'orders_agent']);
  });
  it('dev skips deploy and streams logs', () => {
    expect(argv('dev', { runtime: 'a' })).toEqual(['dev', '--logs', '--skip-deploy', '--runtime', 'a']);
  });
  it('logs uses search mode', () => {
    expect(argv('logs', { runtime: 'a', since: '1h' })).toEqual(['logs', '--json', '--since', '1h', '--limit', '200', '--runtime', 'a']);
  });
  it('create builds a TypeScript scaffold', () => {
    expect(argv('create', { projectName: 'demo1', agentName: 'agent1', framework: 'VercelAI', modelProvider: 'Bedrock', outputDir: 'C:/work' }))
      .toEqual(['create', '--project-name', 'demo1', '--name', 'agent1', '--language', 'TypeScript', '--framework', 'VercelAI',
        '--model-provider', 'Bedrock', '--memory', 'none', '--skip-git', '--skip-install', '--output-dir', 'C:/work', '--json']);
  });
  it('createDryRun adds --dry-run', () => {
    expect(argv('createDryRun', { projectName: 'demo1', agentName: 'agent1', framework: 'VercelAI', modelProvider: 'Bedrock', outputDir: 'C:/work' }))
      .toContain('--dry-run');
  });
});

describe('metadata', () => {
  it('flags AWS-touching and long-running commands', () => {
    expect(COMMANDS.deploy.touchesAws).toBe(true);
    expect(COMMANDS.validate.touchesAws).toBe(false);
    expect(COMMANDS.dev.longRunning).toBe(true);
    expect(COMMANDS.status.touchesAws).toBe(true);
  });
  it('isCommandId rejects unknown ids', () => {
    expect(isCommandId('deploy')).toBe(true);
    expect(isCommandId('remove')).toBe(false);
    expect(isCommandId('add')).toBe(false);
    expect(isCommandId('fetchAccess')).toBe(false);
  });
});

describe('validateParams', () => {
  it('rejects unknown keys', () => {
    expect(() => validateParams(COMMANDS.validate, { extra: 'x' })).toThrow(ParamError);
  });
  it('rejects missing required fields', () => {
    expect(() => validateParams(COMMANDS.invoke, {})).toThrow(/prompt/);
  });
  it.each(['-rf', 'a b', 'a;b', '', 'x'.repeat(101), '1abc', 'a\nb'])('rejects bad name %j', (v) => {
    expect(() => validateParams(COMMANDS.dev, { runtime: v })).toThrow(ParamError);
  });
  it('rejects NUL and oversized prompts', () => {
    expect(() => validateParams(COMMANDS.invoke, { prompt: 'a\0b' })).toThrow(ParamError);
    expect(() => validateParams(COMMANDS.invoke, { prompt: 'x'.repeat(8001) })).toThrow(ParamError);
  });
  it('accepts multi-line prompts', () => {
    expect(validateParams(COMMANDS.invoke, { prompt: 'a\nb' })).toEqual({ prompt: 'a\nb' });
  });
  it('rejects values outside an enum', () => {
    expect(() => validateParams(COMMANDS.logs, { since: '999y' })).toThrow(ParamError);
  });
  it('rejects non-object params', () => {
    expect(() => validateParams(COMMANDS.validate, null)).toThrow(ParamError);
    expect(() => validateParams(COMMANDS.validate, 'x')).toThrow(ParamError);
  });
  it('rejects non-string values', () => {
    expect(() => validateParams(COMMANDS.dev, { runtime: 5 as unknown as string })).toThrow(ParamError);
  });
});

describe('displayCommand', () => {
  it('quotes args with spaces', () => {
    expect(displayCommand('agentcore', ['invoke', '--prompt=hello world'])).toBe('agentcore invoke "--prompt=hello world"');
  });
  it('leaves simple args bare', () => {
    expect(displayCommand('agentcore', ['status', '--json'])).toBe('agentcore status --json');
  });
});

describe('commandsForNode', () => {
  it('runtime nodes offer invoke/dev/logs/traces/package', () => {
    const ids = commandsForNode({ type: 'runtime', name: 'a' }).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['invoke', 'dev', 'logs', 'tracesList', 'package']));
  });
  it('harness nodes offer invokeHarness', () => {
    expect(commandsForNode({ type: 'harness', name: 'h' }).map((c) => c.id)).toContain('invokeHarness');
  });
  it('always offers status; prefills the node name', () => {
    expect(commandsForNode({ type: 'memory', name: 'm' }).map((c) => c.id)).toContain('status');
    expect(commandsForNode({ type: 'runtime', name: 'a' }).find((c) => c.id === 'invoke')!.params).toEqual({ runtime: 'a' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/cli/catalog.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`lib/cli/catalog.ts`:
```ts
import type { GraphNode } from '@/lib/config/types';

export type CommandId = 'validate' | 'status' | 'package' | 'deploy' | 'deployDiff' | 'deployDryRun'
  | 'invoke' | 'invokeHarness' | 'dev' | 'logs' | 'tracesList' | 'create' | 'createDryRun';

export interface FieldDef { key: string; label: string; required: boolean; kind: 'name' | 'text' | 'path' | 'enum'; options?: string[] }

export interface CommandSpec {
  id: CommandId;
  label: string;
  description: string;
  tool: 'agentcore';
  touchesAws: boolean;
  longRunning: boolean;
  cwd: 'project' | 'outputDir';
  fields: FieldDef[];
  build(p: Record<string, string>): string[];
}

export class ParamError extends Error {
  constructor(message: string) { super(message); this.name = 'ParamError'; }
}

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
const SINCE = ['15m', '1h', '6h', '1d', '7d'];
const FRAMEWORKS = ['Strands', 'LangChain_LangGraph', 'GoogleADK', 'OpenAIAgents', 'VercelAI'];
const PROVIDERS = ['Bedrock', 'Anthropic', 'OpenAI', 'Gemini'];

const runtimeField: FieldDef = { key: 'runtime', label: 'Runtime', required: false, kind: 'name' };
const opt = (p: Record<string, string>, flag: string, key: string): string[] => (p[key] ? [flag, p[key]] : []);

const createFields: FieldDef[] = [
  { key: 'projectName', label: 'Project name', required: true, kind: 'name' },
  { key: 'agentName', label: 'Agent name', required: true, kind: 'name' },
  { key: 'framework', label: 'Framework', required: true, kind: 'enum', options: FRAMEWORKS },
  { key: 'modelProvider', label: 'Model provider', required: true, kind: 'enum', options: PROVIDERS },
  { key: 'outputDir', label: 'Output directory', required: true, kind: 'path' },
];
const createArgv = (p: Record<string, string>, dry: boolean): string[] => [
  'create', '--project-name', p.projectName, '--name', p.agentName, '--language', 'TypeScript',
  '--framework', p.framework, '--model-provider', p.modelProvider, '--memory', 'none',
  '--skip-git', '--skip-install', '--output-dir', p.outputDir, ...(dry ? ['--dry-run'] : []), '--json',
];

export const COMMANDS: Record<CommandId, CommandSpec> = {
  validate: { id: 'validate', label: 'Validate config', description: 'Check agentcore/ config files', tool: 'agentcore', touchesAws: false, longRunning: false, cwd: 'project', fields: [], build: () => ['validate', '--json'] },
  status: { id: 'status', label: 'Refresh status', description: 'Show deployed resource status', tool: 'agentcore', touchesAws: true, longRunning: false, cwd: 'project', fields: [], build: () => ['status', '--json'] },
  package: { id: 'package', label: 'Package', description: 'Package agent artifacts without deploying', tool: 'agentcore', touchesAws: false, longRunning: false, cwd: 'project', fields: [runtimeField], build: (p) => ['package', ...opt(p, '--runtime', 'runtime')] },
  deploy: { id: 'deploy', label: 'Deploy', description: 'Deploy project infrastructure to AWS via CDK', tool: 'agentcore', touchesAws: true, longRunning: true, cwd: 'project', fields: [], build: () => ['deploy', '--yes', '--json', '-v'] },
  deployDiff: { id: 'deployDiff', label: 'Deploy (diff only)', description: 'Show the CDK diff without deploying', tool: 'agentcore', touchesAws: true, longRunning: false, cwd: 'project', fields: [], build: () => ['deploy', '--diff', '--json'] },
  deployDryRun: { id: 'deployDryRun', label: 'Deploy (dry run)', description: 'Preview deployment without deploying', tool: 'agentcore', touchesAws: true, longRunning: false, cwd: 'project', fields: [], build: () => ['deploy', '--dry-run', '--json'] },
  invoke: { id: 'invoke', label: 'Invoke', description: 'Invoke a deployed agent', tool: 'agentcore', touchesAws: true, longRunning: false, cwd: 'project',
    fields: [{ key: 'prompt', label: 'Prompt', required: true, kind: 'text' }, runtimeField],
    build: (p) => ['invoke', `--prompt=${p.prompt}`, '--stream', ...opt(p, '--runtime', 'runtime')] },
  invokeHarness: { id: 'invokeHarness', label: 'Invoke harness', description: 'Invoke a deployed harness', tool: 'agentcore', touchesAws: true, longRunning: false, cwd: 'project',
    fields: [{ key: 'prompt', label: 'Prompt', required: true, kind: 'text' }, { key: 'harness', label: 'Harness', required: true, kind: 'name' }],
    build: (p) => ['invoke', `--prompt=${p.prompt}`, '--stream', '--harness', p.harness] },
  dev: { id: 'dev', label: 'Run locally (dev)', description: 'Local dev server with logs (skips auto-deploy)', tool: 'agentcore', touchesAws: false, longRunning: true, cwd: 'project', fields: [runtimeField], build: (p) => ['dev', '--logs', '--skip-deploy', ...opt(p, '--runtime', 'runtime')] },
  logs: { id: 'logs', label: 'Search logs', description: 'Search recent runtime logs', tool: 'agentcore', touchesAws: true, longRunning: false, cwd: 'project',
    fields: [runtimeField, { key: 'since', label: 'Since', required: false, kind: 'enum', options: SINCE }],
    build: (p) => ['logs', '--json', '--since', p.since || '1h', '--limit', '200', ...opt(p, '--runtime', 'runtime')] },
  tracesList: { id: 'tracesList', label: 'List traces', description: 'List recent traces for a runtime', tool: 'agentcore', touchesAws: true, longRunning: false, cwd: 'project', fields: [runtimeField], build: (p) => ['traces', 'list', '--json', ...opt(p, '--runtime', 'runtime')] },
  create: { id: 'create', label: 'Create project', description: 'Scaffold a new AgentCore project (TypeScript)', tool: 'agentcore', touchesAws: false, longRunning: false, cwd: 'outputDir', fields: createFields, build: (p) => createArgv(p, false) },
  createDryRun: { id: 'createDryRun', label: 'Create project (dry run)', description: 'Preview what create would do', tool: 'agentcore', touchesAws: false, longRunning: false, cwd: 'outputDir', fields: createFields, build: (p) => createArgv(p, true) },
};

export function isCommandId(v: unknown): v is CommandId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(COMMANDS, v);
}

export function validateParams(spec: CommandSpec, params: unknown): Record<string, string> {
  if (params === undefined) params = {};
  if (typeof params !== 'object' || params === null || Array.isArray(params)) throw new ParamError('params must be an object');
  const input = params as Record<string, unknown>;
  const known = new Set(spec.fields.map((f) => f.key));
  for (const k of Object.keys(input)) if (!known.has(k)) throw new ParamError(`Unknown parameter '${k}'`);
  const out: Record<string, string> = {};
  for (const f of spec.fields) {
    const v = input[f.key];
    if (v === undefined || v === '') {
      if (f.required) throw new ParamError(`Missing required parameter '${f.key}'`);
      continue;
    }
    if (typeof v !== 'string') throw new ParamError(`Parameter '${f.key}' must be a string`);
    if (v.includes('\0')) throw new ParamError(`Parameter '${f.key}' contains NUL`);
    switch (f.kind) {
      case 'name': if (!NAME.test(v)) throw new ParamError(`'${f.key}' must match ${NAME}`); break;
      case 'enum': if (!f.options!.includes(v)) throw new ParamError(`'${f.key}' must be one of ${f.options!.join(', ')}`); break;
      case 'text': if (v.length > 8000) throw new ParamError(`'${f.key}' is too long (max 8000)`); break;
      case 'path': if (v.length > 1024 || v.startsWith('-') || /[\r\n]/.test(v)) throw new ParamError(`'${f.key}' is not a valid path`); break;
    }
    out[f.key] = v;
  }
  return out;
}

export function displayCommand(file: string, args: string[]): string {
  const q = (a: string) => (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);
  return [file, ...args].map(q).join(' ');
}

export function commandsForNode(n: Pick<GraphNode, 'type' | 'name'>): { id: CommandId; params: Record<string, string> }[] {
  const out: { id: CommandId; params: Record<string, string> }[] = [];
  if (n.type === 'runtime') {
    const p = { runtime: n.name };
    out.push({ id: 'invoke', params: p }, { id: 'dev', params: p }, { id: 'logs', params: p }, { id: 'tracesList', params: p }, { id: 'package', params: p });
  }
  if (n.type === 'harness') out.push({ id: 'invokeHarness', params: { harness: n.name } });
  out.push({ id: 'status', params: {} });
  return out;
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/cli && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: CLI command allowlist with strict parameter validation"
```

---

### Task 6: Process execution (binary resolution, redaction, runner, mock)

**Files:**
- Create: `lib/exec/binary.ts`, `lib/exec/redact.ts`, `lib/exec/run.ts`, `lib/exec/mock.ts`, `lib/exec/index.ts`
- Test: `tests/exec/binary.test.ts`, `tests/exec/redact.test.ts`, `tests/exec/run.test.ts`

**Interfaces:**
- Produces:
```ts
// binary.ts
export function parseNpmCmdShim(text: string, dir: string): string | null;
export function resolveBinary(name: string, env?: NodeJS.ProcessEnv): { file: string; prefixArgs: string[] };  // throws Error with code 'ENOENT'
// redact.ts
export function redact(text: string): string;
// run.ts
export type RunEvent =
  | { type: 'start'; command: string }
  | { type: 'stdout' | 'stderr'; data: string }
  | { type: 'error'; message: string }
  | { type: 'exit'; code: number | null; signal: string | null };
export interface ExecSpec { file: 'agentcore' | 'aws'; args: string[]; cwd: string; env: NodeJS.ProcessEnv }
export class Run { id: string; command: string; events: RunEvent[]; done: boolean;
  push(e: RunEvent): void; subscribe(fn: (e: RunEvent) => void): () => void; cancel(): void; }
export function getRun(id: string): Run | undefined;
export function registerRun(run: Run): void;
export function childEnv(profile?: string, extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function execReal(spec: ExecSpec, display: string): Run;
export function runToCompletion(run: Run, timeoutMs?: number): Promise<{ code: number | null; stdout: string; stderr: string; error?: string }>;
// mock.ts
export function isMock(): boolean;
export function execMock(spec: ExecSpec, display: string): Run;
// index.ts
export function startExec(spec: ExecSpec, display: string): Run;  // registers the run; real or mock
```

- [ ] **Step 1: Failing tests**

`tests/exec/binary.test.ts`:
```ts
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
```

`tests/exec/redact.test.ts`:
```ts
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
```

`tests/exec/run.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { Run, childEnv, execReal, runToCompletion } from '@/lib/exec/run';

describe('Run', () => {
  it('replays buffered events to late subscribers, then streams', () => {
    const r = new Run('cmd');
    r.push({ type: 'stdout', data: 'a' });
    const seen: string[] = [];
    r.subscribe((e) => seen.push(e.type));
    r.push({ type: 'exit', code: 0, signal: null });
    expect(seen).toEqual(['start', 'stdout', 'exit']);
    expect(r.done).toBe(true);
  });
  it('stops notifying after unsubscribe', () => {
    const r = new Run('cmd');
    const seen: string[] = [];
    const off = r.subscribe((e) => seen.push(e.type));
    off();
    r.push({ type: 'stdout', data: 'x' });
    expect(seen).toEqual(['start']);
  });
});

describe('childEnv', () => {
  it('sets AWS_PROFILE and strips other AWS_ credentials', () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIAXXXXXXXXXXXXXXXX';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    process.env.AWS_SESSION_TOKEN = 'tok';
    const env = childEnv('myprof');
    expect(env.AWS_PROFILE).toBe('myprof');
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.AWS_SESSION_TOKEN).toBeUndefined();
    expect(env.NO_COLOR).toBe('1');
    delete process.env.AWS_ACCESS_KEY_ID; delete process.env.AWS_SECRET_ACCESS_KEY; delete process.env.AWS_SESSION_TOKEN;
  });
  it('omits AWS_PROFILE when no profile is given', () => {
    expect(childEnv().AWS_PROFILE).toBeUndefined();
  });
  it('keeps AWS_CONFIG_FILE / AWS_SHARED_CREDENTIALS_FILE locations', () => {
    process.env.AWS_CONFIG_FILE = '/x';
    expect(childEnv('p').AWS_CONFIG_FILE).toBe('/x');
    delete process.env.AWS_CONFIG_FILE;
  });
});

describe('execReal', () => {
  it('reports a missing binary as an error event followed by exit', async () => {
    const run = execReal({ file: 'agentcore', args: [], cwd: process.cwd(), env: { PATH: '' } }, 'agentcore');
    const res = await runToCompletion(run, 5000);
    expect(res.error).toMatch(/not found/i);
    expect(run.done).toBe(true);
  });
});
```
(Real spawning is exercised in Task 8's smoke run; avoid depending on external CLIs in unit tests. A spawn-level test with `node -e` is added below.)

Add to `tests/exec/run.test.ts`:
```ts
import { spawnNodeForTest } from '@/lib/exec/run';

describe('spawn plumbing', () => {
  it('streams stdout/stderr, redacts, and reports exit code', async () => {
    const run = spawnNodeForTest(['-e', "console.log('hi Bearer abc.def'); console.error('oops'); process.exit(3)"]);
    const res = await runToCompletion(run, 10000);
    expect(res.code).toBe(3);
    expect(res.stdout).toContain('hi Bearer [redacted]');
    expect(res.stderr).toContain('oops');
  });
  it('cancel terminates a long-running process', async () => {
    const run = spawnNodeForTest(['-e', 'setInterval(()=>{},1000)']);
    setTimeout(() => run.cancel(), 300);
    const res = await runToCompletion(run, 10000);
    expect(run.done).toBe(true);
    expect(res.code === 0 ? false : true).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/exec`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`lib/exec/binary.ts`:
```ts
import fs from 'node:fs';
import path from 'node:path';

/** npm's Windows .cmd shims end with: "%_prog%"  "%dp0%\node_modules\...\cli.mjs" %* */
export function parseNpmCmdShim(text: string, dir: string): string | null {
  const m = text.match(/"%dp0%\\([^"]+?\.(?:m?js|cjs))"/i) ?? text.match(/"%~dp0\\([^"]+?\.(?:m?js|cjs))"/i);
  return m ? path.join(dir, m[1]) : null;
}

export function resolveBinary(name: string, env: NodeJS.ProcessEnv = process.env): { file: string; prefixArgs: string[] } {
  if (process.platform !== 'win32') return { file: name, prefixArgs: [] };
  // Node >= 18.20 refuses to spawn .cmd/.bat without a shell (EINVAL), so unwrap npm shims.
  const dirs = (env.PATH ?? env.Path ?? '').split(';').filter(Boolean);
  for (const dir of dirs) {
    const exe = path.join(dir, `${name}.exe`);
    if (fs.existsSync(exe)) return { file: exe, prefixArgs: [] };
    const cmd = path.join(dir, `${name}.cmd`);
    if (fs.existsSync(cmd)) {
      const script = parseNpmCmdShim(fs.readFileSync(cmd, 'utf8'), dir);
      if (script && fs.existsSync(script)) return { file: process.execPath, prefixArgs: [script] };
    }
  }
  throw Object.assign(new Error(`'${name}' was not found on PATH`), { code: 'ENOENT' });
}
```

`lib/exec/redact.ts`:
```ts
const RULES: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '[redacted-jwt]'],
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '[redacted-key-id]'],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]'],
  [/((?:aws_)?secret_access_key["']?\s*[:=]\s*["']?)[^\s"',]+/gi, '$1[redacted]'],
  [/((?:client_?secret|secret|password|passwd|(?:access|refresh|id|session)_?token|api_?key)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[redacted]'],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}
```

`lib/exec/run.ts`:
```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolveBinary } from './binary';
import { redact } from './redact';

export type RunEvent =
  | { type: 'start'; command: string }
  | { type: 'stdout' | 'stderr'; data: string }
  | { type: 'error'; message: string }
  | { type: 'exit'; code: number | null; signal: string | null };

export interface ExecSpec { file: 'agentcore' | 'aws'; args: string[]; cwd: string; env: NodeJS.ProcessEnv }

export class Run {
  id = randomUUID();
  events: RunEvent[] = [];
  done = false;
  child?: ChildProcess;
  private listeners = new Set<(e: RunEvent) => void>();
  private cancelHook?: () => void;

  constructor(public command: string) { this.events.push({ type: 'start', command }); }

  setCancelHook(fn: () => void) { this.cancelHook = fn; }

  push(e: RunEvent) {
    if (this.done) return;
    this.events.push(e);
    if (e.type === 'exit') this.done = true;
    for (const l of this.listeners) l(e);
  }

  subscribe(fn: (e: RunEvent) => void): () => void {
    for (const e of this.events) fn(e);
    if (this.done) return () => {};
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  cancel() {
    if (this.done) return;
    if (this.cancelHook) this.cancelHook();
    else this.child?.kill();
  }
}

const g = globalThis as unknown as { __acRuns?: Map<string, Run> };
const runs = (g.__acRuns ??= new Map<string, Run>());

export function registerRun(run: Run) {
  runs.set(run.id, run);
  setTimeout(() => runs.delete(run.id), 30 * 60 * 1000).unref?.();
}
export function getRun(id: string) { return runs.get(id); }

export function childEnv(profile?: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const KEEP = new Set(['AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE', 'AWS_EC2_METADATA_DISABLED']);
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.toUpperCase().startsWith('AWS_') && !KEEP.has(k.toUpperCase())) continue;
    env[k] = v;
  }
  env.NO_COLOR = '1';
  env.FORCE_COLOR = '0';
  if (profile) env.AWS_PROFILE = profile;
  return { ...env, ...extra };
}

function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false });
  else child.kill('SIGTERM');
}

function attach(run: Run, child: ChildProcess) {
  run.child = child;
  run.setCancelHook(() => killTree(child));
  child.stdout?.on('data', (d: Buffer) => run.push({ type: 'stdout', data: redact(d.toString()) }));
  child.stderr?.on('data', (d: Buffer) => run.push({ type: 'stderr', data: redact(d.toString()) }));
  child.on('error', (err: NodeJS.ErrnoException) => {
    run.push({ type: 'error', message: err.code === 'ENOENT' ? `Executable not found: ${err.message}` : err.message });
    run.push({ type: 'exit', code: null, signal: null });
  });
  child.on('close', (code, signal) => run.push({ type: 'exit', code, signal }));
}

export function execReal(spec: ExecSpec, display: string): Run {
  const run = new Run(display);
  let resolved: { file: string; prefixArgs: string[] };
  try {
    resolved = resolveBinary(spec.file, spec.env);
  } catch (e) {
    queueMicrotask(() => {
      run.push({ type: 'error', message: `${(e as Error).message} (is the ${spec.file} CLI installed and on PATH?)` });
      run.push({ type: 'exit', code: null, signal: null });
    });
    return run;
  }
  const child = spawn(resolved.file, [...resolved.prefixArgs, ...spec.args], {
    cwd: spec.cwd, env: spec.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  attach(run, child);
  return run;
}

/** Test helper: spawn this Node binary directly with the same plumbing as execReal. */
export function spawnNodeForTest(args: string[]): Run {
  const run = new Run(`node ${args.join(' ')}`);
  attach(run, spawn(process.execPath, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }));
  return run;
}

export function runToCompletion(run: Run, timeoutMs = 60_000): Promise<{ code: number | null; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    let stdout = '', stderr = '', error: string | undefined;
    let timer: NodeJS.Timeout | undefined;
    const off = run.subscribe((e) => {
      if (e.type === 'stdout') stdout += e.data;
      else if (e.type === 'stderr') stderr += e.data;
      else if (e.type === 'error') error = e.message;
      else if (e.type === 'exit') { if (timer) clearTimeout(timer); queueMicrotask(off); resolve({ code: e.code, stdout, stderr, error }); }
    });
    if (!run.done) {
      timer = setTimeout(() => { error = `Timed out after ${timeoutMs}ms`; run.cancel(); }, timeoutMs);
    }
  });
}
```
Note: `subscribe` replays synchronously, and `off` is invoked via microtask, so calling it before it is assigned is avoided.

`lib/exec/mock.ts`:
```ts
import fs from 'node:fs';
import path from 'node:path';
import { Run, type ExecSpec } from './run';

export const isMock = () => process.env.MOCK === '1';

const g = globalThis as unknown as { __acMockLoggedIn?: boolean };
export const mockSession = {
  get loggedIn() { return g.__acMockLoggedIn === true; },
  set loggedIn(v: boolean) { g.__acMockLoggedIn = v; },
};

function script(run: Run, lines: { t: number; s: 'stdout' | 'stderr'; d: string }[], code = 0, onDone?: () => void) {
  const timers: NodeJS.Timeout[] = [];
  lines.forEach((l) => timers.push(setTimeout(() => run.push({ type: l.s, data: l.d + '\n' }), l.t)));
  const last = Math.max(0, ...lines.map((l) => l.t)) + 150;
  timers.push(setTimeout(() => { onDone?.(); run.push({ type: 'exit', code, signal: null }); }, last));
  run.setCancelHook(() => { timers.forEach(clearTimeout); run.push({ type: 'exit', code: null, signal: 'SIGTERM' }); });
}

function mockStatus(cwd: string): string {
  const resources: unknown[] = [];
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(cwd, 'agentcore', 'agentcore.json'), 'utf8'));
    (doc.runtimes ?? []).forEach((r: { name: string }, i: number) => resources.push({ resourceType: 'agent', name: r.name, deploymentState: i === 0 ? 'deployed' : 'local-only' }));
    (doc.memories ?? []).forEach((m: { name: string }) => resources.push({ resourceType: 'memory', name: m.name, deploymentState: 'local-only' }));
    (doc.agentCoreGateways ?? []).forEach((gw: { name: string; targets?: unknown[] }) =>
      resources.push({ resourceType: 'gateway', name: gw.name, deploymentState: 'deployed', detail: `${gw.targets?.length ?? 0} targets` }));
  } catch { /* fall through with no resources */ }
  return JSON.stringify({ success: true, projectName: 'demo', targetName: 'default', resources });
}

export function execMock(spec: ExecSpec, display: string): Run {
  const run = new Run(display);
  const [a0, a1] = spec.args;
  if (spec.file === 'aws' && a0 === 'sso') {
    script(run, [
      { t: 100, s: 'stdout', d: 'Attempting to automatically open the SSO authorization page in your default browser.' },
      { t: 200, s: 'stdout', d: 'Browser will not be automatically opened.' },
      { t: 300, s: 'stdout', d: 'Open the following URL:' },
      { t: 350, s: 'stdout', d: 'https://device.sso.us-east-1.amazonaws.com/' },
      { t: 400, s: 'stdout', d: 'and enter the code: ABCD-EFGH' },
      { t: 2500, s: 'stdout', d: 'Successfully logged into Start URL: https://mock.awsapps.com/start' },
    ], 0, () => { mockSession.loggedIn = true; });
  } else if (spec.file === 'aws') {
    script(run, [{ t: 50, s: 'stdout', d: '{}' }]);
  } else if (a0 === 'status') {
    script(run, [{ t: 150, s: 'stdout', d: mockStatus(spec.cwd) }]);
  } else if (a0 === 'validate') {
    script(run, [{ t: 100, s: 'stdout', d: '{"success":true}' }]);
  } else if (a0 === 'deploy') {
    script(run, [
      { t: 200, s: 'stdout', d: 'Synthesizing CDK app...' }, { t: 900, s: 'stdout', d: 'orders_agent: CREATE_IN_PROGRESS' },
      { t: 1800, s: 'stdout', d: 'orders_agent: CREATE_COMPLETE' }, { t: 2200, s: 'stdout', d: '{"success":true}' },
    ]);
  } else if (a0 === 'dev') {
    let n = 0;
    const iv = setInterval(() => run.push({ type: 'stdout', data: `[dev] heartbeat ${++n}\n` }), 1000);
    run.setCancelHook(() => { clearInterval(iv); run.push({ type: 'exit', code: null, signal: 'SIGTERM' }); });
  } else if (a0 === 'create') {
    script(run, [{ t: 200, s: 'stdout', d: args(spec).includes('--dry-run') ? 'Would create project (dry run)' : '{"success":true,"mock":true}' }]);
  } else {
    script(run, [{ t: 150, s: 'stdout', d: `(mock) ${a0} ${a1 ?? ''} completed` }]);
  }
  return run;
}
const args = (s: ExecSpec) => s.args;
```

`lib/exec/index.ts`:
```ts
import { execReal, registerRun, type ExecSpec, type Run } from './run';
import { execMock, isMock } from './mock';

export function startExec(spec: ExecSpec, display: string): Run {
  const run = isMock() ? execMock(spec, display) : execReal(spec, display);
  registerRun(run);
  return run;
}
export { isMock };
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/exec && npx tsc --noEmit`
Expected: PASS. On Windows the `.cmd` shim test runs; on POSIX the other variant.

- [ ] **Step 5: Real-binary smoke check (manual)**

Run:
```bash
npx tsx -e "import('./lib/exec/run').then(async m=>{const r=m.execReal({file:'agentcore',args:['--version'],cwd:process.cwd(),env:m.childEnv()},'agentcore --version');console.log(await m.runToCompletion(r,20000))})"
```
(If `tsx` is unavailable, run `npx -y tsx@4 …`.) Expected: `{ code: 0, stdout: '0.31.1\n' (or newer), … }`. This verifies shim unwrapping against the real CLI. If it fails with ENOENT/EINVAL, fix `parseNpmCmdShim` against the actual contents of `%APPDATA%\npm\agentcore.cmd`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: spawn-based runner with shim unwrapping, redaction and mock executor"
```

---

### Task 7: AWS profiles, identity, login

**Files:**
- Create: `lib/aws/config.ts`, `lib/aws/identity.ts`
- Test: `tests/aws/config.test.ts`, `tests/aws/identity.test.ts`

**Interfaces:**
- Consumes: `startExec`, `runToCompletion`, `childEnv` (Task 6), `isMock`, `mockSession` (Task 6).
- Produces:
```ts
// config.ts
export interface AwsProfile { name: string; kind: 'sso' | 'login' | 'other'; region?: string; ssoAccountId?: string; ssoRoleName?: string; ssoStartUrl?: string }
export function parseAwsConfig(text: string): AwsProfile[];
export function readProfiles(): Promise<AwsProfile[]>;           // reads $AWS_CONFIG_FILE or ~/.aws/config; [] if missing; mock => fixtures
export const PROFILE_NAME_RE: RegExp;
// identity.ts
export type IdentityResult =
  | { ok: true; account: string; arn: string; role?: string; region?: string }
  | { ok: false; reason: 'expired' | 'missing-profile' | 'missing-cli' | 'error'; message: string };
export function classifyStsFailure(stderr: string, code: number | null, spawnError?: string): { reason: 'expired' | 'missing-profile' | 'missing-cli' | 'error'; message: string };
export function roleFromArn(arn: string): string | undefined;
export function getIdentity(profile: string, region?: string): Promise<IdentityResult>;
export function loginSpec(profile: AwsProfile): { args: string[] };      // args after `aws`
export function extractDeviceInfo(text: string): { url?: string; code?: string };
```

- [ ] **Step 1: Failing tests**

`tests/aws/config.test.ts`:
```ts
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
```

`tests/aws/identity.test.ts`:
```ts
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
  it('uses aws login for console-login profiles', () => {
    expect(loginSpec({ name: 'default', kind: 'login' }).args).toEqual(['login', '--profile', 'default', '--remote']);
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/aws`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`lib/aws/config.ts`:
```ts
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
```

`lib/aws/identity.ts`:
```ts
import { childEnv, runToCompletion } from '@/lib/exec/run';
import { startExec } from '@/lib/exec';
import { isMock, mockSession } from '@/lib/exec/mock';
import { PROFILE_NAME_RE, readProfiles, type AwsProfile } from './config';

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
  if (p.kind === 'login') return { args: ['login', '--profile', p.name, '--remote'] };
  throw new Error(`Profile '${p.name}' is not an SSO or console-login profile; it cannot be logged in from here.`);
}

export function extractDeviceInfo(text: string): { url?: string; code?: string } {
  const out: { url?: string; code?: string } = {};
  const urls = text.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  out.url = urls.find((u) => /user_code=/.test(u)) ?? urls[0];
  const code = text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/);
  if (code) out.code = code[0];
  if (!out.url) delete out.url;
  return out;
}

export async function findProfile(name: string): Promise<AwsProfile | undefined> {
  return (await readProfiles()).find((p) => p.name === name);
}
```
Verify the `--remote` flag against the installed CLI at execution time (`aws login help`): `--remote` was listed in the synopsis; if its semantics are not "print URL/code instead of opening a browser", drop it and rely on the default browser flow.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/aws && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: AWS profile parsing, STS identity check and login commands"
```

---

### Task 8: API routes (aws, project, recent, run + SSE)

**Files:**
- Create: `lib/store/recent.ts`, `lib/server/http.ts`, `lib/server/project.ts`, `app/api/prereqs/route.ts`, `app/api/aws/profiles/route.ts`, `app/api/aws/whoami/route.ts`, `app/api/aws/login/route.ts`, `app/api/project/open/route.ts`, `app/api/project/graph/route.ts`, `app/api/project/recent/route.ts`, `app/api/run/preview/route.ts`, `app/api/run/route.ts`, `app/api/run/[id]/events/route.ts`, `app/api/run/[id]/route.ts`
- Test: `tests/store/recent.test.ts`, `tests/server/run-plan.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
```ts
// recent.ts
export interface RecentProject { path: string; name: string; lastOpened: string }
export function listRecent(dir?: string): Promise<RecentProject[]>;
export function addRecent(entry: { path: string; name: string }, dir?: string): Promise<void>;     // max 10, newest first, dedupe by path
// http.ts
export function json(data: unknown, status?: number): Response;
export function readJson(req: Request): Promise<Record<string, unknown>>;
export function handle(fn: () => Promise<Response>): Promise<Response>;       // maps PathEscapeError/ParamError/Error to 4xx/5xx JSON {error}
// project.ts
export function buildProjectGraph(path: string, profile?: string): Promise<{ graph: Graph; status: 'ok' | 'skipped' | 'failed'; note?: string }>;
export function detectPrereqs(): Promise<{ agentcore: PrereqInfo; aws: PrereqInfo; uv: PrereqInfo }>;
export interface PrereqInfo { found: boolean; version?: string }
export function planRun(body: Record<string, unknown>): Promise<RunPlan>;
export interface RunPlan { spec: CommandSpec; params: Record<string, string>; exec: ExecSpec; display: string; projectRoot?: string; profile?: string }
```
HTTP contract (JSON unless noted):
- `GET /api/prereqs` → `{agentcore,aws,uv}`
- `GET /api/aws/profiles` → `{profiles: AwsProfile[]}`
- `POST /api/aws/whoami {profile, region?}` → `IdentityResult`
- `POST /api/aws/login {profile}` → `{runId, display}`
- `POST /api/project/open {path}` → `{root, graph, status, note?}` and records a recent
- `POST /api/project/graph {path, profile?}` → `{graph, status, note?}`
- `GET /api/project/recent` → `{recent}`
- `POST /api/run/preview {commandId, params, projectPath?, profile?}` → `{display, label, description, touchesAws, longRunning, fields, identity?}`
- `POST /api/run {commandId, params, projectPath?, profile?, confirm?: {account, region, typedName?}}` → `{runId, display}`; `409 {needsTypedName: true, resources: string[]}` when deploying with pending removals
- `GET /api/run/:id/events` → SSE of `RunEvent`
- `DELETE /api/run/:id` → `{ok:true}`

- [ ] **Step 1: Failing tests**

`tests/store/recent.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addRecent, listRecent } from '@/lib/store/recent';

let dir: string;
beforeAll(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acgui-recent-')); });
afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('recent projects', () => {
  it('starts empty', async () => { expect(await listRecent(dir)).toEqual([]); });
  it('adds newest first and dedupes by path', async () => {
    await addRecent({ path: '/a', name: 'a' }, dir);
    await addRecent({ path: '/b', name: 'b' }, dir);
    await addRecent({ path: '/a', name: 'a' }, dir);
    expect((await listRecent(dir)).map((r) => r.path)).toEqual(['/a', '/b']);
  });
  it('caps at 10', async () => {
    for (let i = 0; i < 15; i++) await addRecent({ path: `/p${i}`, name: `p${i}` }, dir);
    expect(await listRecent(dir)).toHaveLength(10);
  });
  it('recovers from a corrupt file', async () => {
    await fs.writeFile(path.join(dir, 'recent.json'), '{{{');
    expect(await listRecent(dir)).toEqual([]);
  });
  it('stores only path, name and timestamp', async () => {
    await addRecent({ path: '/x', name: 'x' }, dir);
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'recent.json'), 'utf8'));
    expect(Object.keys(raw[0]).sort()).toEqual(['lastOpened', 'name', 'path']);
  });
});
```

`tests/server/run-plan.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { planRun } from '@/lib/server/project';

const fx = path.join(__dirname, '../../fixtures/demo-project');
beforeAll(() => { process.env.MOCK = '1'; });
afterAll(() => { delete process.env.MOCK; });

describe('planRun', () => {
  it('builds argv, cwd and display for an allowlisted command', async () => {
    const p = await planRun({ commandId: 'status', params: {}, projectPath: fx, profile: 'mock-sso' });
    expect(p.exec.file).toBe('agentcore');
    expect(p.exec.args).toEqual(['status', '--json']);
    expect(p.display).toBe('agentcore status --json');
    expect(path.resolve(p.exec.cwd)).toBe(path.resolve(fx));
    expect(p.exec.env.AWS_PROFILE).toBe('mock-sso');
  });
  it('rejects a command that is not on the allowlist', async () => {
    await expect(planRun({ commandId: 'remove', params: {}, projectPath: fx })).rejects.toThrow(/Unknown command/);
  });
  it('rejects a non-project directory', async () => {
    await expect(planRun({ commandId: 'validate', params: {}, projectPath: path.join(fx, 'app') })).rejects.toThrow(/Not an AgentCore project/);
  });
  it('rejects invalid params', async () => {
    await expect(planRun({ commandId: 'dev', params: { runtime: '-x' }, projectPath: fx })).rejects.toThrow();
  });
  it('requires a profile for AWS-touching commands', async () => {
    await expect(planRun({ commandId: 'deploy', params: {}, projectPath: fx })).rejects.toThrow(/profile/i);
  });
  it('does not require a profile for local commands', async () => {
    await expect(planRun({ commandId: 'validate', params: {}, projectPath: fx })).resolves.toBeTruthy();
  });
  it('create runs in the output directory, not a project', async () => {
    const p = await planRun({ commandId: 'createDryRun', params: { projectName: 'demo1', agentName: 'agent1', framework: 'VercelAI', modelProvider: 'Bedrock', outputDir: fx } });
    expect(path.resolve(p.exec.cwd)).toBe(path.resolve(fx));
  });
  it('create refuses a non-existent output directory', async () => {
    await expect(planRun({ commandId: 'createDryRun', params: { projectName: 'demo1', agentName: 'agent1', framework: 'VercelAI', modelProvider: 'Bedrock', outputDir: path.join(fx, 'nope') } })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/store tests/server`
Expected: FAIL.

- [ ] **Step 3: Implement store, http helpers, planning**

`lib/store/recent.ts`:
```ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface RecentProject { path: string; name: string; lastOpened: string }
const defaultDir = () => process.env.AGENTCORE_GUI_HOME ?? path.join(os.homedir(), '.agentcore-gui');

export async function listRecent(dir = defaultDir()): Promise<RecentProject[]> {
  try {
    const data = JSON.parse(await fs.readFile(path.join(dir, 'recent.json'), 'utf8'));
    if (!Array.isArray(data)) return [];
    return data.filter((r) => typeof r?.path === 'string' && typeof r?.name === 'string').map((r) => ({ path: r.path, name: r.name, lastOpened: String(r.lastOpened ?? '') }));
  } catch { return []; }
}

export async function addRecent(entry: { path: string; name: string }, dir = defaultDir()): Promise<void> {
  const cur = (await listRecent(dir)).filter((r) => r.path !== entry.path);
  const next = [{ path: entry.path, name: entry.name, lastOpened: new Date().toISOString() }, ...cur].slice(0, 10);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `recent.json.${process.pid}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(next, null, 2));
  await fs.rename(tmp, path.join(dir, 'recent.json'));
}
```

`lib/server/http.ts`:
```ts
import { PathEscapeError } from '@/lib/fs/safe-read';
import { ParamError } from '@/lib/cli/catalog';

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch { return {}; }
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try { return await fn(); } catch (e) {
    if (e instanceof PathEscapeError) return json({ error: e.message }, 400);
    if (e instanceof ParamError) return json({ error: e.message }, 400);
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return json({ error: `Path not found: ${err.message}` }, 404);
    return json({ error: err.message ?? 'Internal error' }, /Not an AgentCore project|Unknown command|profile|Invalid|Not a directory/i.test(err.message) ? 400 : 500);
  }
}
```

`lib/server/project.ts`:
```ts
import fs from 'node:fs/promises';
import { loadProject } from '@/lib/config/load';
import { applyStatus } from '@/lib/config/status';
import type { Graph } from '@/lib/config/types';
import { resolveProjectRoot } from '@/lib/fs/safe-read';
import { COMMANDS, displayCommand, isCommandId, validateParams, type CommandSpec } from '@/lib/cli/catalog';
import { parseStatusOutput, parseValidateOutput } from '@/lib/cli/parsers';
import { PROFILE_NAME_RE } from '@/lib/aws/config';
import { getIdentity } from '@/lib/aws/identity';
import { childEnv, runToCompletion, type ExecSpec } from '@/lib/exec/run';
import { startExec } from '@/lib/exec';
import { isMock } from '@/lib/exec/mock';

export interface PrereqInfo { found: boolean; version?: string }
export interface RunPlan { spec: CommandSpec; params: Record<string, string>; exec: ExecSpec; display: string; projectRoot?: string; profile?: string }

export async function planRun(body: Record<string, unknown>): Promise<RunPlan> {
  const id = body.commandId;
  if (!isCommandId(id)) throw new Error(`Unknown command: ${String(id)}`);
  const spec = COMMANDS[id];
  const params = validateParams(spec, body.params);
  const profile = typeof body.profile === 'string' && body.profile ? body.profile : undefined;
  if (profile && !PROFILE_NAME_RE.test(profile)) throw new Error('Invalid profile name');
  if (spec.touchesAws && !profile) throw new Error('An AWS profile is required for this command');

  let cwd: string;
  let projectRoot: string | undefined;
  if (spec.cwd === 'project') {
    projectRoot = await resolveProjectRoot(String(body.projectPath ?? ''));
    cwd = projectRoot;
  } else {
    const dir = params.outputDir;
    const st = await fs.stat(dir);
    if (!st.isDirectory()) throw new Error(`Not a directory: ${dir}`);
    cwd = await fs.realpath(dir);
  }
  const args = spec.build(params);
  return {
    spec, params, projectRoot, profile,
    exec: { file: spec.tool, args, cwd, env: childEnv(profile) },
    display: displayCommand(spec.tool, args),
  };
}

export async function buildProjectGraph(projectPath: string, profile?: string):
  Promise<{ graph: Graph; status: 'ok' | 'skipped' | 'failed'; note?: string }> {
  const root = await resolveProjectRoot(projectPath);
  const graph = await loadProject(root);

  const run = (id: 'validate' | 'status') => {
    const args = COMMANDS[id].build({});
    return runToCompletion(startExec({ file: 'agentcore', args, cwd: root, env: childEnv(profile) }, displayCommand('agentcore', args)), 60_000);
  };

  const v = await run('validate');
  const validate = parseValidateOutput(v.stdout, v.code);

  let status: ReturnType<typeof parseStatusOutput> | null = null;
  let note: string | undefined;
  let outcome: 'ok' | 'skipped' | 'failed' = 'skipped';
  if (!profile) {
    note = 'Select an AWS profile and log in to load deployment status.';
  } else {
    const ident = await getIdentity(profile);
    if (!ident.ok) {
      note = `Deployment status unavailable: ${ident.message}`;
    } else {
      const s = await run('status');
      status = parseStatusOutput(s.stdout);
      if (status.ok) outcome = 'ok';
      else { outcome = 'failed'; note = `Status failed: ${status.error}`; }
    }
  }
  return { graph: applyStatus(graph, status && status.ok ? status.resources : null, validate), status: outcome, note };
}

async function version(cmd: 'agentcore' | 'aws' | 'uv'): Promise<PrereqInfo> {
  if (isMock()) return { found: true, version: 'mock' };
  const { resolveBinary } = await import('@/lib/exec/binary');
  try { resolveBinary(cmd); } catch { return { found: false }; }
  const { execReal } = await import('@/lib/exec/run');
  const res = await runToCompletion(execReal({ file: cmd as 'agentcore', args: ['--version'], cwd: process.cwd(), env: childEnv() }, `${cmd} --version`), 20_000);
  return res.code === 0 ? { found: true, version: (res.stdout || res.stderr).trim().split('\n')[0] } : { found: false };
}

export async function detectPrereqs() {
  const [agentcore, aws, uv] = await Promise.all([version('agentcore'), version('aws'), version('uv')]);
  return { agentcore, aws, uv };
}
```
`uv` is not in `ExecSpec['file']`; widen `ExecSpec.file` to `'agentcore' | 'aws' | 'uv'` in `lib/exec/run.ts` and drop the `as 'agentcore'` cast.

- [ ] **Step 4: Implement routes**

All route files start with:
```ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
```

`app/api/prereqs/route.ts`:
```ts
import { detectPrereqs } from '@/lib/server/project';
import { handle, json } from '@/lib/server/http';
export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';
export const GET = () => handle(async () => json(await detectPrereqs()));
```

`app/api/aws/profiles/route.ts`:
```ts
import { readProfiles } from '@/lib/aws/config';
import { handle, json } from '@/lib/server/http';
export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';
export const GET = () => handle(async () => json({ profiles: await readProfiles() }));
```

`app/api/aws/whoami/route.ts`:
```ts
import { getIdentity } from '@/lib/aws/identity';
import { findProfile } from '@/lib/aws/identity';
import { handle, json, readJson } from '@/lib/server/http';
export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';
export const POST = (req: Request) => handle(async () => {
  const b = await readJson(req);
  const name = String(b.profile ?? '');
  const prof = await findProfile(name);
  return json(await getIdentity(name, prof?.region));
});
```

`app/api/aws/login/route.ts`:
```ts
import { findProfile, loginSpec } from '@/lib/aws/identity';
import { childEnv } from '@/lib/exec/run';
import { startExec } from '@/lib/exec';
import { displayCommand } from '@/lib/cli/catalog';
import { handle, json, readJson } from '@/lib/server/http';
export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';
export const POST = (req: Request) => handle(async () => {
  const b = await readJson(req);
  const prof = await findProfile(String(b.profile ?? ''));
  if (!prof) return json({ error: 'Unknown profile' }, 400);
  const { args } = loginSpec(prof);
  const display = displayCommand('aws', args);
  const run = startExec({ file: 'aws', args, cwd: process.cwd(), env: childEnv(prof.name) }, display);
  return json({ runId: run.id, display });
});
```

`app/api/project/open/route.ts`:
```ts
import { buildProjectGraph } from '@/lib/server/project';
import { addRecent } from '@/lib/store/recent';
import { handle, json, readJson } from '@/lib/server/http';
export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';
export const POST = (req: Request) => handle(async () => {
  const b = await readJson(req);
  const r = await buildProjectGraph(String(b.path ?? ''), typeof b.profile === 'string' ? b.profile : undefined);
  await addRecent({ path: r.graph.root, name: r.graph.projectName });
  return json({ root: r.graph.root, ...r });
});
```

`app/api/project/graph/route.ts`:
```ts
import { buildProjectGraph } from '@/lib/server/project';
import { handle, json, readJson } from '@/lib/server/http';
export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';
export const POST = (req: Request) => handle(async () => {
  const b = await readJson(req);
  return json(await buildProjectGraph(String(b.path ?? ''), typeof b.profile === 'string' ? b.profile : undefined));
});
```

`app/api/project/recent/route.ts`:
```ts
import { listRecent } from '@/lib/store/recent';
import { handle, json } from '@/lib/server/http';
export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';
export const GET = () => handle(async () => json({ recent: await listRecent() }));
```

`app/api/run/preview/route.ts`:
```ts
import { planRun } from '@/lib/server/project';
import { getIdentity, findProfile } from '@/lib/aws/identity';
import { handle, json, readJson } from '@/lib/server/http';
export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';
export const POST = (req: Request) => handle(async () => {
  const b = await readJson(req);
  // Preview tolerates missing required params so the dialog can show fields; validate leniently.
  let plan;
  try { plan = await planRun(b); } catch (e) {
    const { COMMANDS, isCommandId } = await import('@/lib/cli/catalog');
    if (!isCommandId(b.commandId)) throw e;
    const spec = COMMANDS[b.commandId];
    return json({ display: '(fill in the fields)', label: spec.label, description: spec.description, touchesAws: spec.touchesAws, longRunning: spec.longRunning, fields: spec.fields, problem: (e as Error).message });
  }
  const identity = plan.spec.touchesAws && plan.profile
    ? await getIdentity(plan.profile, (await findProfile(plan.profile))?.region)
    : undefined;
  return json({ display: plan.display, label: plan.spec.label, description: plan.spec.description, touchesAws: plan.spec.touchesAws, longRunning: plan.spec.longRunning, fields: plan.spec.fields, identity });
});
```

`app/api/run/route.ts`:
```ts
import { planRun } from '@/lib/server/project';
import { getIdentity, findProfile } from '@/lib/aws/identity';
import { COMMANDS, displayCommand } from '@/lib/cli/catalog';
import { parseStatusOutput } from '@/lib/cli/parsers';
import { childEnv, runToCompletion } from '@/lib/exec/run';
import { startExec } from '@/lib/exec';
import { handle, json, readJson } from '@/lib/server/http';
export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';

export const POST = (req: Request) => handle(async () => {
  const b = await readJson(req);
  const plan = await planRun(b);

  if (plan.spec.touchesAws) {
    const prof = await findProfile(plan.profile!);
    const ident = await getIdentity(plan.profile!, prof?.region);
    if (!ident.ok) return json({ error: `AWS session check failed: ${ident.message}`, reason: ident.reason }, 401);
    if (plan.spec.id === 'deploy') {
      const c = (b.confirm ?? {}) as { account?: string; region?: string; typedName?: string };
      const region = ident.region ?? prof?.region;
      if (c.account !== ident.account || c.region !== region) {
        return json({ error: 'Deploy requires confirming the target account and region.', account: ident.account, region }, 400);
      }
      // Destructive guard: pending-removal resources require typing the project name.
      const sargs = COMMANDS.status.build({});
      const st = parseStatusOutput((await runToCompletion(startExec(
        { file: 'agentcore', args: sargs, cwd: plan.exec.cwd, env: plan.exec.env }, displayCommand('agentcore', sargs)), 60_000)).stdout);
      const pending = st.ok ? st.resources.filter((r) => r.deploymentState === 'pending-removal').map((r) => `${r.resourceType}:${r.name}`) : [];
      if (pending.length > 0) {
        const projectName = plan.exec.cwd.split(/[\\/]/).pop() ?? '';
        if (c.typedName !== projectName) return json({ needsTypedName: true, resources: pending, projectName }, 409);
      }
    }
  }
  const run = startExec(plan.exec, plan.display);
  return json({ runId: run.id, display: plan.display });
});
```
Note: the "project name" used for typed confirmation is the project directory's basename (what the user sees in the picker); the UI shows the same value from `projectName` in the 409 body.

`app/api/run/[id]/events/route.ts`:
```ts
import { getRun } from '@/lib/exec/run';
export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return new Response('Not found', { status: 404 });
  const enc = new TextEncoder();
  let off = () => {};
  const stream = new ReadableStream({
    start(c) {
      off = run.subscribe((e) => {
        try { c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); if (e.type === 'exit') c.close(); } catch { /* closed */ }
      });
    },
    cancel() { off(); },
  });
  req.signal.addEventListener('abort', () => off());
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
}
```

`app/api/run/[id]/route.ts`:
```ts
import { getRun } from '@/lib/exec/run';
import { json } from '@/lib/server/http';
export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return json({ error: 'Not found' }, 404);
  run.cancel();
  return json({ ok: true });
}
```

- [ ] **Step 5: Verify tests and types**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Smoke test the API in mock mode**

Run (terminal A): `npm run dev:mock`
Then (terminal B; `$FX` is the absolute path to `fixtures/demo-project`):
```bash
curl -s http://127.0.0.1:4317/api/aws/profiles
curl -s -X POST http://127.0.0.1:4317/api/aws/whoami -H "Origin: http://127.0.0.1:4317" -H "Content-Type: application/json" -d '{"profile":"mock-sso"}'
curl -s -X POST http://127.0.0.1:4317/api/project/open -H "Origin: http://127.0.0.1:4317" -H "Content-Type: application/json" -d "{\"path\":\"$FX\"}" | head -c 600
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:4317/api/project/open -d '{}'                       # expect 403 (no Origin)
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: evil.example.com" http://127.0.0.1:4317/api/aws/profiles          # expect 403
curl -s -X POST http://127.0.0.1:4317/api/project/open -H "Origin: http://127.0.0.1:4317" -H "Content-Type: application/json" -d '{"path":"C:/Windows"}'   # expect error JSON (Not an AgentCore project)
```
Expected: profiles `mock-sso`, `mock-login`; whoami `{"ok":false,"reason":"expired",…}`; open returns a graph with 17 nodes; the two guard checks print `403`; the last returns an error.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: aws, project, recent and run API routes with SSE streaming"
```

---

### Task 9: UI shell — SSO bar, project picker, API client

**Files:**
- Create: `lib/ui/api.ts`, `components/theme.ts`, `components/AppShell.tsx`, `components/SsoBar.tsx`, `components/ProjectPicker.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: HTTP contract from Task 8; `Graph`, `IdentityResult`, `AwsProfile`, `RecentProject`.
- Produces (`lib/ui/api.ts`): `getJson<T>(url)`, `postJson<T>(url, body)`, which throw `ApiError {status, body}` on non-2xx; `components/theme.ts` exports `TYPE_STYLE: Record<NodeType, {label: string; color: string}>`, `STATUS_STYLE: Record<NodeStatus, {label: string; className: string}>`.
- `AppShell` owns: `profile`, `identity`, `projectPath`, `graph`, `selectedId`, `activeRun`, `pendingAction`; renders `SsoBar`, `ProjectPicker`, and (Tasks 10–11) `GraphView`, `NodePanel`, `RunDialog`, `CommandDrawer`.

- [ ] **Step 1: API client and theme**

`lib/ui/api.ts`:
```ts
export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) { super(message); }
}
async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = undefined;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  if (!res.ok) {
    const msg = (body as { error?: string } | undefined)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, body, msg);
  }
  return body as T;
}
export const getJson = <T,>(url: string) => fetch(url, { cache: 'no-store' }).then((r) => parse<T>(r));
export const postJson = <T,>(url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => parse<T>(r));
```

`components/theme.ts`:
```ts
import type { NodeStatus, NodeType } from '@/lib/config/types';

export const TYPE_STYLE: Record<NodeType, { label: string; color: string }> = {
  runtime: { label: 'Runtime', color: '#3b82f6' },
  harness: { label: 'Harness', color: '#6366f1' },
  gateway: { label: 'Gateway', color: '#f59e0b' },
  gatewayTarget: { label: 'Gateway target', color: '#fbbf24' },
  memory: { label: 'Memory', color: '#10b981' },
  knowledgeBase: { label: 'Knowledge base', color: '#14b8a6' },
  credential: { label: 'Credential', color: '#ef4444' },
  evaluator: { label: 'Evaluator', color: '#a855f7' },
  onlineEval: { label: 'Online eval', color: '#c084fc' },
  policyEngine: { label: 'Policy engine', color: '#ec4899' },
  policy: { label: 'Policy', color: '#f472b6' },
  configBundle: { label: 'Config bundle', color: '#06b6d4' },
  abTest: { label: 'A/B test', color: '#0ea5e9' },
  dataset: { label: 'Dataset', color: '#84cc16' },
  capacityProvider: { label: 'Capacity provider', color: '#78716c' },
  paymentManager: { label: 'Payment manager', color: '#f97316' },
  paymentConnector: { label: 'Payment connector', color: '#fb923c' },
  external: { label: 'External', color: '#94a3b8' },
  other: { label: 'Other', color: '#64748b' },
};

export const STATUS_STYLE: Record<NodeStatus, { label: string; className: string }> = {
  deployed: { label: 'deployed', className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  'not-deployed': { label: 'not deployed', className: 'bg-slate-500/20 text-slate-300 border-slate-500/40' },
  'pending-removal': { label: 'pending removal', className: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  error: { label: 'error', className: 'bg-red-500/20 text-red-300 border-red-500/40' },
  unknown: { label: 'status unknown', className: 'bg-slate-700/30 text-slate-400 border-slate-600/40' },
};
```

- [ ] **Step 2: SsoBar**

`components/SsoBar.tsx`:
```tsx
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

  useEffect(() => { getJson<{ profiles: AwsProfile[] }>('/api/aws/profiles').then((r) => setProfiles(r.profiles)).catch((e) => setErr(e.message)); }, []);

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
```

- [ ] **Step 3: ProjectPicker**

`components/ProjectPicker.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import type { RecentProject } from '@/lib/store/recent';
import { getJson } from '@/lib/ui/api';

interface Props {
  current: string;
  onOpen: (path: string) => Promise<void> | void;
  onCreate: () => void;
  error: string | null;
  refreshKey: number;
}

export default function ProjectPicker({ current, onOpen, onCreate, error, refreshKey }: Props) {
  const [path, setPath] = useState(current);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  useEffect(() => { setPath(current); }, [current]);
  useEffect(() => { getJson<{ recent: RecentProject[] }>('/api/project/recent').then((r) => setRecent(r.recent)).catch(() => {}); }, [refreshKey]);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 bg-slate-900/70 px-4 py-2 text-sm">
      <input
        className="min-w-[24rem] flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 font-mono"
        placeholder="Absolute path to an AgentCore project (contains agentcore/agentcore.json)"
        value={path} onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && path) void onOpen(path); }}
      />
      <button className="rounded bg-blue-600 px-3 py-1 font-medium hover:bg-blue-500 disabled:opacity-50" disabled={!path} onClick={() => onOpen(path)}>Open</button>
      <select className="rounded border border-slate-600 bg-slate-800 px-2 py-1" value="" onChange={(e) => e.target.value && onOpen(e.target.value)}>
        <option value="">Recent…</option>
        {recent.map((r) => <option key={r.path} value={r.path}>{r.name} — {r.path}</option>)}
      </select>
      <button className="rounded border border-slate-600 px-3 py-1 hover:bg-slate-800" onClick={onCreate}>New project…</button>
      {error && <div className="w-full text-red-400" role="alert">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 4: AppShell (graph/panel/drawer wired in Tasks 10–11)**

`components/AppShell.tsx`:
```tsx
'use client';
import { useCallback, useState } from 'react';
import type { Graph } from '@/lib/config/types';
import type { IdentityResult } from '@/lib/aws/identity';
import { postJson } from '@/lib/ui/api';
import SsoBar from './SsoBar';
import ProjectPicker from './ProjectPicker';

export interface ActiveRun { id: string; title: string }
export interface PendingAction { commandId: string; params: Record<string, string>; title?: string }

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
        {graph && <pre className="p-4 text-xs">{JSON.stringify({ nodes: graph.nodes.length, edges: graph.edges.length, warnings: graph.warnings.length, note }, null, 2)}</pre>}
      </main>
      {/* Tasks 10–11 render GraphView, NodePanel, RunDialog, CommandDrawer here using the state above */}
      <span hidden>{String(selectedId)}{String(activeRun?.id)}{String(pending?.commandId)}{refresh.name}{setLoginTick.name}</span>
    </div>
  );
}
```

`app/page.tsx`:
```tsx
import AppShell from '@/components/AppShell';
export default function Page() { return <AppShell />; }
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

Manual (mock): `npm run dev:mock`, open `http://127.0.0.1:4317`. Select `mock-sso` → amber "session has expired" with a **Log in** button (button wired to the drawer in Task 11, so only confirm it appears). Select `mock-login` → green "Account 123456789012 · Developer · us-east-1". Open the fixture path (absolute path to `fixtures/demo-project`) → the placeholder prints `{"nodes":17,…}`. Enter `C:\Windows` → red error "Not an AgentCore project". Reload the page → the project appears under "Recent…".

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: app shell with SSO bar and project picker"
```

---

### Task 10: Graph view — layout, nodes, filters

**Files:**
- Create: `components/graph/layout.ts`, `components/graph/ResourceNode.tsx`, `components/graph/Filters.tsx`, `components/graph/GraphView.tsx`
- Modify: `components/AppShell.tsx`
- Test: `tests/ui/layout.test.ts`

**Interfaces:**
- Produces:
```ts
// layout.ts
export const NODE_W = 220, NODE_H = 72;
export function layoutGraph(nodes: { id: string }[], edges: { from: string; to: string }[]): Record<string, { x: number; y: number }>;
export function visibleSubgraph(graph: Graph, hiddenTypes: Set<NodeType>): { nodes: GraphNode[]; edges: GraphEdge[] };
// GraphView props
{ graph: Graph; selectedId: string | null; onSelect(id: string | null): void }
```

- [ ] **Step 1: Failing tests**

`tests/ui/layout.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { layoutGraph, visibleSubgraph, NODE_W } from '@/components/graph/layout';
import type { Graph, GraphNode } from '@/lib/config/types';

const n = (id: string, type: GraphNode['type']): GraphNode => ({ id, type, name: id, status: 'unknown', config: {}, envVarNames: [], warnings: [] });
const graph: Graph = {
  projectName: 'p', root: '/p', warnings: [],
  nodes: [n('a', 'runtime'), n('b', 'memory'), n('c', 'gateway')],
  edges: [
    { id: '1', from: 'a', to: 'b', kind: 'declared', label: 'x', source: '' },
    { id: '2', from: 'c', to: 'a', kind: 'inferred', label: 'y', source: '' },
  ],
};

describe('layoutGraph', () => {
  it('positions every node, left-to-right by edge direction', () => {
    const pos = layoutGraph(graph.nodes, graph.edges);
    expect(Object.keys(pos).sort()).toEqual(['a', 'b', 'c']);
    expect(pos.c.x).toBeLessThan(pos.a.x);
    expect(pos.a.x).toBeLessThan(pos.b.x);
    expect(pos.b.x - pos.a.x).toBeGreaterThanOrEqual(NODE_W);
  });
  it('handles an empty graph and ignores edges to unknown nodes', () => {
    expect(layoutGraph([], [])).toEqual({});
    expect(Object.keys(layoutGraph([{ id: 'a' }], [{ from: 'a', to: 'ghost' }]))).toEqual(['a']);
  });
  it('handles cycles without throwing', () => {
    expect(() => layoutGraph([{ id: 'a' }, { id: 'b' }], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])).not.toThrow();
  });
});

describe('visibleSubgraph', () => {
  it('hides nodes of filtered types and their edges', () => {
    const v = visibleSubgraph(graph, new Set(['memory']));
    expect(v.nodes.map((x) => x.id)).toEqual(['a', 'c']);
    expect(v.edges.map((e) => e.id)).toEqual(['2']);
  });
  it('shows everything when nothing is hidden', () => {
    const v = visibleSubgraph(graph, new Set());
    expect(v.nodes).toHaveLength(3);
    expect(v.edges).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ui`
Expected: FAIL.

- [ ] **Step 3: Implement layout**

`components/graph/layout.ts`:
```ts
import dagre from 'dagre';
import type { Graph, GraphEdge, GraphNode, NodeType } from '@/lib/config/types';

export const NODE_W = 220;
export const NODE_H = 72;

export function layoutGraph(nodes: { id: string }[], edges: { from: string; to: string }[]): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 90, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) if (ids.has(e.from) && ids.has(e.to)) g.setEdge(e.from, e.to);
  dagre.layout(g);
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const p = g.node(n.id);
    out[n.id] = { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 };
  }
  return out;
}

export function visibleSubgraph(graph: Graph, hidden: Set<NodeType>): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = graph.nodes.filter((n) => !hidden.has(n.type));
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
}
```

- [ ] **Step 4: Node, filters, GraphView**

`components/graph/ResourceNode.tsx`:
```tsx
'use client';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphNode } from '@/lib/config/types';
import { STATUS_STYLE, TYPE_STYLE } from '../theme';

export type ResourceNodeData = { node: GraphNode; selected: boolean };

export default function ResourceNode({ data }: NodeProps) {
  const { node, selected } = data as ResourceNodeData;
  const t = TYPE_STYLE[node.type];
  const s = STATUS_STYLE[node.status];
  return (
    <div
      className={`w-[220px] rounded-md border bg-slate-800 px-3 py-2 shadow ${selected ? 'ring-2 ring-white' : ''}`}
      style={{ borderColor: t.color, borderLeftWidth: 6 }}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-500" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide" style={{ color: t.color }}>{t.label}</span>
        {node.warnings.length > 0 && <span title={node.warnings.join('\n')} className="text-amber-400">⚠</span>}
      </div>
      <div className="truncate text-sm font-medium text-slate-100" title={node.name}>{node.name}</div>
      <span className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-[10px] ${s.className}`}>{s.label}</span>
      <Handle type="source" position={Position.Right} className="!bg-slate-500" />
    </div>
  );
}
```

`components/graph/Filters.tsx`:
```tsx
'use client';
import type { NodeType } from '@/lib/config/types';
import { TYPE_STYLE } from '../theme';

export default function Filters({ present, hidden, onToggle }: { present: NodeType[]; hidden: Set<NodeType>; onToggle: (t: NodeType) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Filter by resource type">
      {present.map((t) => {
        const off = hidden.has(t);
        return (
          <button
            key={t} onClick={() => onToggle(t)} aria-pressed={!off}
            className={`rounded-full border px-2 py-0.5 text-xs ${off ? 'border-slate-700 text-slate-500 line-through' : 'text-slate-100'}`}
            style={off ? undefined : { borderColor: TYPE_STYLE[t].color, background: TYPE_STYLE[t].color + '22' }}
          >{TYPE_STYLE[t].label}</button>
        );
      })}
    </div>
  );
}
```

`components/graph/GraphView.tsx`:
```tsx
'use client';
import { useMemo, useState } from 'react';
import { Background, Controls, MarkerType, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Graph, NodeType } from '@/lib/config/types';
import { layoutGraph, visibleSubgraph } from './layout';
import ResourceNode from './ResourceNode';
import Filters from './Filters';

const nodeTypes = { resource: ResourceNode };

interface Props { graph: Graph; selectedId: string | null; onSelect: (id: string | null) => void; onRefresh: () => void; loading: boolean }

export default function GraphView({ graph, selectedId, onSelect, onRefresh, loading }: Props) {
  const [hidden, setHidden] = useState<Set<NodeType>>(new Set());
  const present = useMemo(() => [...new Set(graph.nodes.map((n) => n.type))], [graph.nodes]);
  const { nodes: vn, edges: ve } = useMemo(() => visibleSubgraph(graph, hidden), [graph, hidden]);
  const pos = useMemo(() => layoutGraph(vn, ve), [vn, ve]);

  const rfNodes: Node[] = vn.map((n) => ({ id: n.id, type: 'resource', position: pos[n.id], data: { node: n, selected: n.id === selectedId } }));
  const rfEdges: Edge[] = ve.map((e) => ({
    id: e.id, source: e.from, target: e.to, label: e.label + (e.kind === 'inferred' ? ' (inferred)' : ''),
    animated: false,
    style: { stroke: e.kind === 'inferred' ? '#f59e0b' : '#94a3b8', strokeDasharray: e.kind === 'inferred' ? '6 4' : undefined, strokeWidth: 1.5 },
    labelStyle: { fill: '#cbd5e1', fontSize: 10 }, labelBgStyle: { fill: '#0b1020' },
    markerEnd: { type: MarkerType.ArrowClosed, color: e.kind === 'inferred' ? '#f59e0b' : '#94a3b8' },
  }));

  const toggle = (t: NodeType) => setHidden((h) => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-3 py-2">
        <button onClick={onRefresh} disabled={loading} className="rounded border border-slate-600 px-2 py-1 text-sm hover:bg-slate-800 disabled:opacity-50">{loading ? 'Refreshing…' : '⟳ Refresh'}</button>
        <Filters present={present} hidden={hidden} onToggle={toggle} />
        <span className="ml-auto flex items-center gap-3 text-xs text-slate-400">
          <span><span className="inline-block w-6 border-t-2 border-slate-400 align-middle" /> declared</span>
          <span><span className="inline-block w-6 border-t-2 border-dashed border-amber-500 align-middle" /> inferred</span>
        </span>
      </div>
      {graph.warnings.length > 0 && (
        <details className="border-b border-amber-700/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">
          <summary className="cursor-pointer">⚠ {graph.warnings.length} warning{graph.warnings.length > 1 ? 's' : ''}</summary>
          <ul className="mt-1 list-disc pl-5">{graph.warnings.map((w, i) => <li key={i}><b>{w.scope}</b>: {w.message}</li>)}</ul>
        </details>
      )}
      <div className="min-h-0 flex-1">
        <ReactFlow
          key={graph.root + vn.map((n) => n.id).join(',')}
          nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} fitView minZoom={0.1}
          nodesDraggable={false} nodesConnectable={false} edgesFocusable={false}
          onNodeClick={(_, n) => onSelect(n.id)} onPaneClick={() => onSelect(null)}
          colorMode="dark"
        >
          <Background /><Controls showInteractive={false} /><MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire into AppShell**

In `components/AppShell.tsx`, import `GraphView` and replace the placeholder `<pre>` block:
```tsx
import GraphView from './graph/GraphView';
...
{graph && (
  <GraphView graph={graph} selectedId={selectedId} onSelect={setSelectedId} onRefresh={refresh} loading={loading} />
)}
```
Remove nothing else yet (the hidden `<span>` stays until Task 11).

- [ ] **Step 6: Verify**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS.

Manual (mock, fixture opened with `mock-login` selected): 17 nodes laid out left→right; edges labelled; inferred edges (orders_agent → ordersMemory, → tools-gw, planner_agent → planner_agentMemory, support_h → tools-gw, kb-target → docs_kb) dashed amber; `orders_agent` shows "deployed", `tools-gw` and its targets "deployed", others "not deployed"; warning banner lists `futureThing` and `missing_eval`; toggling the "Memory" chip removes memory nodes + their edges; scroll zooms, drag pans; Refresh re-fetches.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: React Flow graph view with dagre layout, filters and status badges"
```

---

### Task 11: Side panel, run dialog, command drawer

**Files:**
- Create: `components/NodePanel.tsx`, `components/RunDialog.tsx`, `components/CommandDrawer.tsx`, `components/useRunStream.ts`
- Modify: `components/AppShell.tsx`, `components/SsoBar.tsx` (no change needed beyond the `loginDoneSignal` already present)

**Interfaces:**
- Consumes: `commandsForNode`, `COMMANDS` types (client-safe: `lib/cli/catalog.ts` has no Node imports), `/api/run*` contract, `extractDeviceInfo` (`lib/aws/identity.ts` imports server modules, so **move `extractDeviceInfo` into `lib/aws/device.ts`** and re-export it from `identity.ts`; update the import in `tests/aws/identity.test.ts` only if it breaks).
- Produces: `useRunStream(runId): { lines: { stream: 'stdout' | 'stderr' | 'system'; text: string }[]; exited: boolean; exitCode: number | null }`.

- [ ] **Step 1: Make `extractDeviceInfo` client-safe**

Create `lib/aws/device.ts` with the `extractDeviceInfo` function body from Task 7 (exported), and in `lib/aws/identity.ts` replace the function with `export { extractDeviceInfo } from './device';`.

Run: `npx vitest run tests/aws && npx tsc --noEmit` → PASS.

- [ ] **Step 2: `useRunStream`**

`components/useRunStream.ts`:
```ts
'use client';
import { useEffect, useState } from 'react';
import type { RunEvent } from '@/lib/exec/run';

export interface Line { stream: 'stdout' | 'stderr' | 'system'; text: string }

export function useRunStream(runId: string | null, onExit?: (code: number | null) => void) {
  const [lines, setLines] = useState<Line[]>([]);
  const [exited, setExited] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);

  useEffect(() => {
    setLines([]); setExited(false); setExitCode(null);
    if (!runId) return;
    const es = new EventSource(`/api/run/${runId}/events`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as RunEvent;
      if (e.type === 'start') setLines((l) => [...l, { stream: 'system', text: `$ ${e.command}` }]);
      else if (e.type === 'stdout' || e.type === 'stderr') setLines((l) => [...l, { stream: e.type as 'stdout' | 'stderr', text: e.data }]);
      else if (e.type === 'error') setLines((l) => [...l, { stream: 'stderr', text: `error: ${e.message}` }]);
      else if (e.type === 'exit') {
        setExited(true); setExitCode(e.code);
        setLines((l) => [...l, { stream: 'system', text: `[exited with code ${e.code ?? 'none'}${e.signal ? `, signal ${e.signal}` : ''}]` }]);
        es.close(); onExit?.(e.code);
      }
    };
    es.onerror = () => { es.close(); setExited((x) => x || true); };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return { lines, exited, exitCode };
}
```
(`import type` from `lib/exec/run` is erased at build, so no Node code reaches the client bundle.)

- [ ] **Step 3: `CommandDrawer`**

`components/CommandDrawer.tsx`:
```tsx
'use client';
import { useEffect, useMemo, useRef } from 'react';
import { extractDeviceInfo } from '@/lib/aws/device';
import { useRunStream } from './useRunStream';

interface Props { run: { id: string; title: string } | null; onClose: () => void; onExit: (code: number | null) => void }

export default function CommandDrawer({ run, onClose, onExit }: Props) {
  const { lines, exited, exitCode } = useRunStream(run?.id ?? null, onExit);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [lines]);
  const device = useMemo(() => extractDeviceInfo(lines.map((l) => l.text).join('\n')), [lines]);
  if (!run) return null;

  async function cancel() { await fetch(`/api/run/${run!.id}`, { method: 'DELETE' }); }

  return (
    <section className="flex h-64 flex-col border-t border-slate-700 bg-slate-950" aria-label="Command output">
      <header className="flex items-center gap-3 border-b border-slate-800 px-3 py-1 text-sm">
        <span className="truncate font-mono text-slate-300">{run.title}</span>
        <span className={`rounded px-1.5 text-xs ${!exited ? 'bg-blue-500/20 text-blue-300' : exitCode === 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
          {!exited ? 'running' : exitCode === 0 ? 'succeeded' : 'failed'}
        </span>
        <span className="ml-auto flex gap-2">
          {!exited && <button className="rounded border border-red-600 px-2 text-red-300 hover:bg-red-900/30" onClick={cancel}>Stop</button>}
          <button className="rounded border border-slate-600 px-2 hover:bg-slate-800" onClick={onClose}>Close</button>
        </span>
      </header>
      {(device.url || device.code) && !exited && (
        <div className="border-b border-amber-700/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100" data-testid="device-info">
          Complete sign-in{device.url && <> at <a className="underline" href={device.url} target="_blank" rel="noreferrer noopener">{device.url}</a></>}
          {device.code && <> and enter code <b className="font-mono text-base tracking-widest">{device.code}</b></>}
        </div>
      )}
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs">
        {lines.map((l, i) => (
          <span key={i} className={l.stream === 'stderr' ? 'text-red-300' : l.stream === 'system' ? 'text-slate-500' : 'text-slate-200'}>{l.text.endsWith('\n') ? l.text : l.text + '\n'}</span>
        ))}
        <div ref={endRef} />
      </pre>
    </section>
  );
}
```

- [ ] **Step 4: `RunDialog` (shows exact command, collects fields, confirms)**

`components/RunDialog.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import type { FieldDef } from '@/lib/cli/catalog';
import type { IdentityResult } from '@/lib/aws/identity';
import { ApiError, postJson } from '@/lib/ui/api';

interface Preview {
  display: string; label: string; description: string; touchesAws: boolean; longRunning: boolean;
  fields: FieldDef[]; identity?: IdentityResult; problem?: string;
}
interface Props {
  action: { commandId: string; params: Record<string, string> } | null;
  projectPath: string; profile: string;
  onCancel: () => void;
  onStarted: (runId: string, title: string) => void;
}

export default function RunDialog({ action, projectPath, profile, onCancel, onStarted }: Props) {
  const [params, setParams] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState('');
  const [need, setNeed] = useState<{ resources: string[]; projectName: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setParams(action?.params ?? {}); setPreview(null); setNeed(null); setTyped(''); setErr(null); setAck(false); }, [action]);

  useEffect(() => {
    if (!action) return;
    let live = true;
    postJson<Preview>('/api/run/preview', { commandId: action.commandId, params, projectPath: projectPath || undefined, profile: profile || undefined })
      .then((p) => live && setPreview(p)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [action, params, projectPath, profile]);

  if (!action) return null;
  const ident = preview?.identity;
  const identOk = ident?.ok ? ident : null;
  const isDeploy = action.commandId === 'deploy';
  const region = identOk?.region;
  const blocked = (preview?.touchesAws && !profile) || (preview?.touchesAws && ident && !ident.ok) || !!preview?.problem
    || (isDeploy && !ack) || (!!need && typed !== need.projectName);

  async function run() {
    setBusy(true); setErr(null);
    try {
      const r = await postJson<{ runId: string; display: string }>('/api/run', {
        commandId: action!.commandId, params, projectPath: projectPath || undefined, profile: profile || undefined,
        confirm: isDeploy && identOk ? { account: identOk.account, region, typedName: need ? typed : undefined } : undefined,
      });
      onStarted(r.runId, r.display);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const b = e.body as { resources: string[]; projectName: string };
        setNeed({ resources: b.resources, projectName: b.projectName });
      } else setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={preview?.label ?? 'Run command'}>
      <div className="w-full max-w-xl rounded-lg border border-slate-600 bg-slate-900 p-4 shadow-xl">
        <h2 className="text-lg font-semibold">{preview?.label ?? 'Run command'}</h2>
        {preview && <p className="text-sm text-slate-400">{preview.description}</p>}

        {preview?.fields.map((f) => (
          <label key={f.key} className="mt-3 block text-sm">
            <span className="text-slate-300">{f.label}{f.required && ' *'}</span>
            {f.kind === 'enum' ? (
              <select className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1" value={params[f.key] ?? ''} onChange={(e) => setParams({ ...params, [f.key]: e.target.value })}>
                <option value="">—</option>{f.options!.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : f.key === 'prompt' ? (
              <textarea className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1" rows={3} value={params[f.key] ?? ''} onChange={(e) => setParams({ ...params, [f.key]: e.target.value })} />
            ) : (
              <input className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 font-mono" value={params[f.key] ?? ''} onChange={(e) => setParams({ ...params, [f.key]: e.target.value })} />
            )}
          </label>
        ))}

        <div className="mt-3 text-xs text-slate-400">Exact command</div>
        <pre className="mt-1 overflow-x-auto rounded bg-black/50 p-2 font-mono text-xs text-emerald-300" data-testid="exact-command">{preview?.display ?? '…'}</pre>
        {preview?.problem && <p className="mt-1 text-xs text-amber-300">{preview.problem}</p>}

        {preview?.touchesAws && (
          <div className="mt-3 rounded border border-slate-700 p-2 text-sm">
            {!profile && <span className="text-amber-300">Select an AWS profile first.</span>}
            {ident && !ident.ok && <span className="text-amber-300">{ident.message} Log in from the top bar, then retry.</span>}
            {identOk && <span>Will run against account <b>{identOk.account}</b>, region <b>{region ?? 'unknown'}</b>, as <b>{identOk.role ?? identOk.arn}</b>.</span>}
          </div>
        )}
        {isDeploy && (
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
            <span>I confirm deploying to account <b>{identOk?.account ?? '?'}</b> in <b>{region ?? '?'}</b>.</span>
          </label>
        )}
        {need && (
          <div className="mt-3 rounded border border-red-600/60 bg-red-500/10 p-2 text-sm">
            <p className="text-red-300">This deploy will remove: <b>{need.resources.join(', ')}</b>.</p>
            <p className="mt-1">Type <b className="font-mono">{need.projectName}</b> to confirm.</p>
            <input className="mt-1 w-full rounded border border-red-700 bg-slate-800 px-2 py-1 font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
        )}
        {err && <p className="mt-2 text-sm text-red-400" role="alert">{err}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded border border-slate-600 px-3 py-1 hover:bg-slate-800" onClick={onCancel}>Cancel</button>
          <button className="rounded bg-blue-600 px-3 py-1 font-medium hover:bg-blue-500 disabled:opacity-40" disabled={blocked || busy || !preview} onClick={run}>{busy ? 'Starting…' : 'Run'}</button>
        </div>
      </div>
    </div>
  );
}
```
Because `CommandId = 'createDryRun'` has no `projectPath`, `RunDialog` passes `projectPath` only when set; the server's `planRun` ignores it for `cwd: 'outputDir'` commands.

- [ ] **Step 5: `NodePanel`**

`components/NodePanel.tsx`:
```tsx
'use client';
import type { Graph, GraphNode } from '@/lib/config/types';
import { commandsForNode, COMMANDS, type CommandId } from '@/lib/cli/catalog';
import { STATUS_STYLE, TYPE_STYLE } from './theme';
import { MASK } from '@/lib/config/sanitize';

interface Props {
  graph: Graph; node: GraphNode;
  onSelect: (id: string) => void;
  onRun: (a: { commandId: CommandId; params: Record<string, string> }) => void;
  onClose: () => void;
}

function vscodeHref(root: string, rel: string): string {
  const abs = (root + '/' + rel).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  return `vscode://file/${encodeURI(abs.replace(/^\//, ''))}`;
}

export default function NodePanel({ graph, node, onSelect, onRun, onClose }: Props) {
  const out = graph.edges.filter((e) => e.from === node.id);
  const inn = graph.edges.filter((e) => e.to === node.id);
  const name = (id: string) => graph.nodes.find((n) => n.id === id)?.name ?? id;
  const t = TYPE_STYLE[node.type];
  const s = STATUS_STYLE[node.status];
  const cmds = commandsForNode(node);

  const Edge = ({ id, other, label, kind, dir }: { id: string; other: string; label: string; kind: string; dir: '→' | '←' }) => (
    <li key={id} className="flex items-center gap-2">
      <span className="text-slate-500">{dir}</span>
      <button className="truncate text-blue-300 hover:underline" onClick={() => onSelect(other)}>{name(other)}</button>
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`rounded px-1 text-[10px] ${kind === 'inferred' ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700 text-slate-300'}`}>{kind}</span>
    </li>
  );

  return (
    <aside className="flex w-[26rem] shrink-0 flex-col overflow-y-auto border-l border-slate-700 bg-slate-900 p-4 text-sm" aria-label="Resource details">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase" style={{ color: t.color }}>{t.label}</div>
          <h2 className="break-all text-lg font-semibold">{node.name}</h2>
          <span className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-xs ${s.className}`}>{s.label}{node.statusDetail ? ` · ${node.statusDetail}` : ''}</span>
        </div>
        <button className="rounded border border-slate-600 px-2 hover:bg-slate-800" onClick={onClose} aria-label="Close panel">✕</button>
      </div>

      {node.warnings.length > 0 && (
        <ul className="mt-3 list-disc rounded border border-amber-700/40 bg-amber-500/10 p-2 pl-6 text-xs text-amber-200">{node.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}

      {node.sourcePath && (
        <p className="mt-3 text-xs">Source: <code>{node.sourcePath}</code>{' '}
          <a className="text-blue-300 underline" href={vscodeHref(graph.root, node.sourcePath)}>Open in VS Code</a></p>
      )}

      <h3 className="mt-4 font-semibold">Connections</h3>
      {out.length + inn.length === 0 && <p className="text-slate-500">None</p>}
      <ul className="mt-1 space-y-1">
        {out.map((e) => <Edge key={e.id} id={e.id} other={e.to} label={e.label} kind={e.kind} dir="→" />)}
        {inn.map((e) => <Edge key={e.id} id={e.id} other={e.from} label={e.label} kind={e.kind} dir="←" />)}
      </ul>

      {node.envVarNames.length > 0 && (
        <>
          <h3 className="mt-4 font-semibold">Environment variables</h3>
          <ul className="mt-1 font-mono text-xs">{node.envVarNames.map((n) => <li key={n}>{n} = {MASK}</li>)}</ul>
        </>
      )}

      <h3 className="mt-4 font-semibold">Commands</h3>
      <div className="mt-1 flex flex-wrap gap-2">
        {cmds.map((c) => (
          <button key={c.id} className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800" title={COMMANDS[c.id].description} onClick={() => onRun({ commandId: c.id, params: c.params })}>
            {COMMANDS[c.id].label}
          </button>
        ))}
      </div>

      <h3 className="mt-4 font-semibold">Configuration</h3>
      <pre className="mt-1 max-h-96 overflow-auto rounded bg-black/40 p-2 text-xs">{JSON.stringify(node.config, null, 2)}</pre>
    </aside>
  );
}
```

- [ ] **Step 6: Final AppShell wiring (toolbar actions, panel, dialog, drawer)**

Replace `components/AppShell.tsx`'s `<main>` and trailing hidden span with:
```tsx
import NodePanel from './NodePanel';
import RunDialog from './RunDialog';
import CommandDrawer from './CommandDrawer';
import type { CommandId } from '@/lib/cli/catalog';
// PendingAction.commandId type -> CommandId
...
const selected = graph?.nodes.find((n) => n.id === selectedId) ?? null;
const toolbar: { id: CommandId; label: string }[] = [
  { id: 'validate', label: 'Validate' }, { id: 'package', label: 'Package' },
  { id: 'deployDiff', label: 'Deploy diff' }, { id: 'deploy', label: 'Deploy…' },
];
...
{graph && (
  <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/50 px-4 py-1 text-sm">
    <span className="font-semibold">{graph.projectName}</span>
    {note && <span className="text-xs text-amber-300">{note}</span>}
    <span className="ml-auto flex gap-2">
      {toolbar.map((t) => (
        <button key={t.id} className="rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-800" onClick={() => setPending({ commandId: t.id, params: {} })}>{t.label}</button>
      ))}
    </span>
  </div>
)}
<main className="relative flex min-h-0 flex-1">
  {!graph && <div className="m-auto text-slate-400">{loading ? 'Loading…' : 'Open a project to see its graph.'}</div>}
  {graph && <GraphView graph={graph} selectedId={selectedId} onSelect={setSelectedId} onRefresh={refresh} loading={loading} />}
  {graph && selected && (
    <NodePanel graph={graph} node={selected} onSelect={setSelectedId} onClose={() => setSelectedId(null)}
      onRun={(a) => setPending(a)} />
  )}
</main>
<CommandDrawer
  run={activeRun} onClose={() => setActiveRun(null)}
  onExit={(code) => {
    if (activeRun?.title.startsWith('Log in') || activeRun?.title.startsWith('aws ')) setLoginTick((t) => t + 1);
    else if (code === 0 && graph) refresh();
  }}
/>
<RunDialog
  action={pending} projectPath={projectPath} profile={profile}
  onCancel={() => setPending(null)}
  onStarted={(id, title) => { setPending(null); setActiveRun({ id, title }); }}
/>
```
Set `PendingAction.commandId` to `CommandId`. The login run's title is `Log in: aws …`; use `startsWith('Log in')` as the single discriminator and drop the `'aws '` check. The "New project…" button already opens `RunDialog` with `createDryRun`; after a successful dry run the user can run the real thing via a **"Run for real"** follow-up: in `RunDialog`, when `action.commandId === 'createDryRun'`, render an extra button that calls `onSwitch('create', params)`; implement by adding an optional `onSwitch?: (commandId: string, params: Record<string,string>) => void` prop and having AppShell pass `(id, p) => setPending({ commandId: id as CommandId, params: p })`. (The spec requires showing the exact command first; the dry-run dialog already shows it, and the switch re-opens the dialog showing the real command.)

- [ ] **Step 7: Verify**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS.

Manual walkthrough in mock mode (`npm run dev:mock`):
1. Select `mock-sso` → "Log in" appears → click → drawer opens, within ~0.5 s shows the amber box "Complete sign-in at https://device.sso.us-east-1.amazonaws.com/ and enter code ABCD-EFGH"; after ~2.5 s the run succeeds, the identity badge turns green automatically.
2. Open the fixture; click `orders_agent` → panel shows config (ORDERS_API_KEY / LOG_LEVEL names with `••••`, no `sk-live-123` anywhere on the page), connections with inferred badges, "Open in VS Code" link, commands.
3. Click **Invoke** → dialog shows the exact command (`agentcore invoke "--prompt=…" --stream --runtime orders_agent` once a prompt is typed), account/region line; Run → streamed mock output in the drawer.
4. Toolbar **Deploy…** → checkbox must be ticked before Run is enabled; output streams; on exit the graph refreshes.
5. Select `mock-login`'s opposite (no profile): Deploy shows "Select an AWS profile first" and Run is disabled.
6. **Run locally (dev)** on a runtime → heartbeat lines every second; **Stop** ends it with signal SIGTERM.
7. **New project…** → dialog with fields; filling them shows the exact `agentcore create … --dry-run` command; "Run for real" switches to the real command.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: node side panel, confirmation dialog and streaming command drawer"
```

---

### Task 12: README, limitations, real-CLI verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README**

`README.md`:
```markdown
# AgentCore GUI

A local, read-only visualizer for AWS Bedrock AgentCore projects. It draws the project's resources as an interactive graph and runs allowlisted `agentcore` / `aws` CLI commands for you, streaming their output. It never edits project files.

## Prerequisites
- Node.js 20+ (developed on 22)
- AgentCore CLI (`agentcore`, tested with 0.31.1) on PATH
- AWS CLI v2 (`aws`) on PATH, with an SSO (`sso_session`) or console-login (`login_session`) profile in `~/.aws/config`
- Optional: `uv` (needed only for Python project scaffolds; without it the UI offers TypeScript scaffolds only)

## Run
    npm install
    npm run dev          # http://127.0.0.1:4317   (binds to 127.0.0.1 only)
    npm run dev:mock     # same, but with a fixture project and fake AWS/CLI — no AWS needed
    npm run build && npm start

In mock mode open the bundled fixture: `fixtures/demo-project` (use its absolute path).

## Using it
1. Pick an AWS profile (top bar). If the session is expired, click **Log in** — the device URL and code appear in the bottom drawer.
2. Open a project directory (must contain `agentcore/agentcore.json`) or **New project…**.
3. Click nodes for config, connections, masked env var names, and commands. Solid edges are declared in config; dashed amber edges are inferred.
4. Every action shows its exact command first. Deploy requires confirming account/region (and typing the project name if it would remove resources).

## Safety model
- Localhost only; Host/Origin checked on every request.
- Child processes via `spawn` (no shell); the browser can only pick commands from an allowlist (`lib/cli/catalog.ts`).
- Project reads are confined to the selected directory (realpath, symlink-safe); `.env*` files are never opened.
- Env var values and secret-like fields are masked; streamed output is redacted for tokens/keys.
- AWS tokens are never read or stored; `AWS_PROFILE` is set only in child environments.
- App state (recent projects) lives in `~/.agentcore-gui/recent.json`.

## Layout
`lib/config` (parser → `Graph`), `lib/cli` (allowlist, argv, output parsers), `lib/exec` (spawn, redaction, mock), `lib/aws` (profiles, STS, login), `app/api` (routes), `components` (UI).

## Known limitations
- Deployed-state and deployed `status --json` shapes are unverified (only `local-only` projects were observable); status parsing is best-effort and mock fixtures for deployed data are inferred from the schema.
- The CLI itself writes logs/state under `agentcore/.cli/` (even for `status`); this app does not.
- `fetch access` (returns tokens) and `traces get` (writes files) are intentionally excluded; so are `add`/`remove`/`import`/`archive`.
- Python scaffolding needs `uv`; the UI offers TypeScript only.
- Inferred edges (ARN/name matching, naming convention, connector parameters) can be wrong and are labelled.
- `aws login --remote` behaviour depends on the installed AWS CLI version.
- `logs`/`traces list` flags are taken from `--help`; their non-interactive behaviour is unverified against live data.
- Prototype: single user, no auth beyond localhost binding, no persistence beyond the recent-projects list.
```

- [ ] **Step 2: Full verification**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all green.

- [ ] **Step 3: Real-CLI check (non-mock, no AWS calls)**

1. Scaffold a throwaway TypeScript project in a temp dir with the CLI itself (this is what the "New project" flow runs):
   `agentcore create --project-name probe --name probeagent --language TypeScript --framework VercelAI --model-provider Bedrock --memory none --skip-git --skip-install --output-dir <tempdir> --json`
2. `npm run dev` (real mode), open `<tempdir>/probe` with **no profile selected**: graph shows the runtime, status note "Select an AWS profile…", `validate` ran (no error warning).
3. Select your `default` profile: if its session is valid the nodes show "not deployed"; if not, the bar shows the expired message and **Log in** runs `aws login --profile default --remote` (confirm it prints a URL/code; if the flag misbehaves, drop `--remote` in `loginSpec` and its test).
4. Run **Validate** and **Package** from the toolbar and confirm output streams; confirm `agentcore/` files were not modified by this app (`git status`/mtime check on `agentcore.json`).
5. Try opening `C:\Windows` and a path with `..` segments: both rejected.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: README, safety model and known limitations"
```

---

## Self-Review (completed)

**Spec coverage:** localhost binding + Host/Origin guard (T1); safe reads/traversal/symlinks/.env (T2); node types, declared vs inferred edges, warnings, masking (T3–4); status badges + validate errors (T4); command allowlist/non-interactive flags/param validation (T5); spawn-without-shell incl. Windows shim, redaction, AWS_PROFILE-only env, SSE, cancel (T6, T8); profiles/STS/login/device code (T7, T11); project open/create/recent (T8–9, T11); dagre layout, pan/zoom, filters, refresh, side panel with connections/env names/commands/VS Code link (T10–11); exact-command display, account/region confirmation, typed confirmation for removals, SSO re-check before AWS commands (T8, T11); mock mode with real fixture (T3, T6, T8); README + limitations (T12). Spec items deliberately narrowed: `fetch access` and `traces get` (conflicts with "never display tokens"/"read-only") — recorded in Global Constraints and README.

**Placeholder scan:** none. Two "verify against the installed CLI" notes (`aws login --remote`, `agentcore logs` flags) are explicit contingencies with the fallback stated.

**Type consistency:** `nodeId`/`Builder`/`parseAgentCore` (T3) reused in T4; `StatusResource` from `lib/cli/parsers` used by `applyStatus`; `ExecSpec.file` widened to include `'uv'` in T8 (noted); `CommandId` used by catalog, planRun, UI; `IdentityResult`, `AwsProfile`, `RunEvent` consistent across tasks.
