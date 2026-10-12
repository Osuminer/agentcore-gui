# AgentCore GUI — Design Spec

Date: 2026-10-12 · Status: draft for review

## 1. Purpose
A local-only prototype web UI that visualizes an AWS Bedrock AgentCore project as an interactive graph and runs AgentCore CLI commands on the user's behalf. Developers still edit code in their own editor.

**Success:** open a project directory (or the mock fixture), see every resource and its relationships, click a node for config/connections/commands, and run allowlisted CLI commands with streamed logs, without the app ever writing a project file or exposing a secret.

## 2. Decisions (agreed)
- Stack: Next.js (App Router) + TypeScript + Tailwind, `@xyflow/react`, dagre layout.
- Server binds to `127.0.0.1` only; route handlers use `child_process.spawn` (argv array, no shell); output streamed via SSE.
- v1 CLI actions: `validate`, `status`, `package`, `deploy` (+ `--diff`, `--dry-run`), `invoke`, `dev` (stoppable), `logs`, `traces list/get`, `fetch access`, and `create` for new projects. **Excluded:** `add`, `remove`, `import`, `archive` and other config-mutating or destructive-by-design commands.
- `create` offers TypeScript only when `uv` is not detected (Python scaffolds need it).
- Out of scope: wizard, env var editing, code editing, hosted deployment.

## 3. Facts discovered (AgentCore CLI 0.31.1)
- Commands are interactive unless a `[non-interactive]` flag (`--json`, `--yes`, `--name`, …) is passed. The adapter always passes one.
- Project root = directory containing `agentcore/agentcore.json`. Files: `agentcore.json` (source of truth, typed by `agentcore/.llm-context/agentcore.ts`), `aws-targets.json` (`[{name,account,region}]`), `.cli/deployed-state.json` (`{targets:{}}`; populated shape unverified), `.env.local` (secrets, never read), `app/<harness>/harness.json`.
- `status --json` → `{success, projectName, targetName, resources:[{resourceType,name,deploymentState: local-only|deployed|pending-removal, detail?}], deployedState, logPath}`. `validate --json` → `{success}` or `{success:false,error}`.
- The CLI itself writes logs under `agentcore/.cli/logs/` even for `status`.
- Default AWS profile on this machine uses `login_session` (not SSO).

## 4. Architecture
```
app/                      Next.js routes + UI
  api/aws/*               profiles, whoami, login (SSE)
  api/project/*           open, create, graph, recent
  api/run                 POST start (allowlisted command id + params) -> run id; GET SSE stream; DELETE cancel
components/               Graph, NodePanel, Toolbar, CommandDrawer, Confirm dialogs
lib/config/               parser: agentcore.json (+harness.json) -> Graph {nodes, edges, warnings}
lib/cli/                  adapter: command builders, spawn wrapper, status/validate parsers
lib/aws/                  ~/.aws/config parser, sts check, login command builders
lib/fs/safe-read.ts       realpath-confined reads
lib/mock/                 fixture project + canned CLI outputs
```
UI depends only on `Graph`; CLI/config format changes are absorbed in `lib/config` and `lib/cli`.

### 4.1 Graph model
`Node {id, type, name, status: not-deployed|deployed|error|unknown, config (sanitized), envVarNames[], sourcePath?, warnings[]}`
`Edge {id, from, to, kind: declared|inferred, label, source (json pointer or rule)}`
`Warning {scope, message, path?}`
Unknown resource types render as generic nodes; unparseable sections add warnings rather than failing the graph.

### 4.2 Edge derivation
| Edge | Source | Kind |
|---|---|---|
| gateway → target | `agentCoreGateways[].targets[]` | declared |
| target → runtime(/endpoint) | `httpRuntime.runtime`, `runtimeEndpoint` | declared |
| target → credential | `outboundAuth.credentialName` | declared |
| target → knowledge base | `connectorId` + configurations | declared |
| gateway → policy engine | `policyEngineConfiguration.policyEngineName` | declared |
| knowledge base → gateway | `knowledgeBases[].gateway` | declared |
| runtime → capacity provider | `capacityProviderConfiguration.capacityProviderName` | declared |
| runtime → memory/gateway/runtime | `connections[]` (ARN matched to project resources) | declared / inferred |
| harness → memory | `harness.json` `memory.name` | declared |
| harness → gateway | ARN in tool config | inferred |
| online eval → runtime, evaluators | `agent`, `endpoint`, `evaluators[]` | declared |
| A/B test → gateway, target, config bundle | `gatewayRef`, variants | declared |
| payment connector → credential | `credentialName` | declared |
| mcpRuntimeTool → runtime | `bindings[].runtimeName` | declared |
| runtime → `<name>Memory` | naming convention | inferred |
Status badges come from `status --json` matched on `(resourceType,name)`; `validate` errors attach as error status/warnings.

### 4.3 Security model
- Reads confined to the project root: `realpath` both sides, reject `..` and symlink escapes; `.env*` files are never opened.
- Env var values masked everywhere; only names reach the browser. Secret-looking fields stripped from node config.
- `/api/run` accepts a command id + validated params, never raw argv. Origin/Host checks reject non-localhost requests (DNS rebinding/CSRF).
- AWS: `AWS_PROFILE` set only in the child env. Tokens/credentials never read, stored, logged or displayed.
- App-owned state (recent projects) lives in the user's app-data dir, not the project.

### 4.4 AWS session flow
List profiles from `~/.aws/config` (SSO via `sso_session`/`sso_start_url`; `login_session` profiles also supported). Validate with `aws sts get-caller-identity --profile X`; show account/role/region. If expired, offer Log in: `aws sso login --profile X --use-device-code` (or `aws login --profile X` for `login_session`; flag support verified at build time), streaming output and extracting URL + code. Re-check before every AWS-touching command. Errors handled: missing `aws`/`agentcore`, missing profile, expired session, non-zero exit.

### 4.5 Command execution
Every action shows the exact command first. `deploy` additionally shows account/region and defaults to a diff/dry-run offer. Destructive commands (e.g. deploy removing resources) require typed confirmation. Logs stream into a bottom drawer; long-running runs (`dev`) are cancellable. Concurrency: one run per project at a time.

### 4.6 Graph UI
dagre auto-layout, pan/zoom, type filters, refresh, node styling by type, status badges, dashed edges for inferred, warning list. Side panel: sanitized config, in/out connections, env var names (masked), relevant commands, optional "Open in VS Code" (`vscode://file/…`) for source files.

### 4.7 Mock mode
`MOCK=1` (or UI toggle) uses a fixture project covering every resource type plus canned `status`/`validate`/streamed outputs and a fake SSO profile, so no AWS or CLI is needed.

## 5. Testing
Unit tests for parser (fixture + malformed inputs), safe-read (traversal, symlinks), `~/.aws/config` parsing, CLI output parsers, command allowlist/param validation. Smoke test of the server in mock mode.

## 6. Known limitations / risks
- Deployed-state and deployed `status --json` shapes are unverified; parsing is best-effort and fixtures for them are inferred from the schema.
- The CLI writes logs/state into the project (not by this app).
- Python scaffolding requires `uv`.
- Inferred edges can be wrong; they are labeled as such.
- Prototype: no auth beyond localhost binding, single user.
