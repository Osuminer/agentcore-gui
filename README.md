# AgentCore GUI

A local, read-only visualizer for AWS Bedrock AgentCore projects. It draws a project's resources as an interactive graph and runs allowlisted `agentcore` / `aws` CLI commands for you, streaming their output. It never edits project files.

## Prerequisites
- Node.js 20+ (developed on 22)
- AgentCore CLI (`agentcore`, tested with 0.31.1) on PATH
- AWS CLI v2 (`aws`) on PATH, with an SSO (`sso_session`) or console-login (`login_session`) profile in `~/.aws/config`
- Optional: `uv` (needed only for Python project scaffolds; without it the UI offers TypeScript scaffolds only)

## Run
```
npm install
npm run dev          # http://127.0.0.1:4317   (binds to 127.0.0.1 only)
npm run dev:mock     # same, with a fixture project and fake AWS/CLI — no AWS needed
npm run build && npm start
npm test             # unit tests
```
In mock mode, open the bundled fixture by absolute path: `fixtures/demo-project`. Mock profiles: `mock-sso` (starts expired; "Log in" simulates a device-code login) and `mock-login` (always valid).

## Using it
1. Pick an AWS profile (top bar). If the session is expired, click **Log in**; the device URL and code appear in the bottom drawer.
2. Open a project directory (must contain `agentcore/agentcore.json`) or choose **New project…**.
3. Click a node for its config, connections, masked env var names and commands. Solid edges are declared in config; dashed amber edges are inferred (ARN/name matching) and labelled. Drag nodes to rearrange them; positions are remembered per project in this browser only (localStorage), and **Reset layout** returns to the auto-layout.
4. Every action shows its exact command first. Deploy requires confirming account/region and, if it would remove resources, typing the project name.

## Safety model
- Localhost only; `Host` and `Origin` are checked on every request.
- Child processes run via `spawn` (no shell). The browser can only pick commands from an allowlist (`lib/cli/catalog.ts`) with validated parameters.
- Project reads are confined to the selected directory (realpath, symlink/junction-safe); `.env*` files are never opened.
- Env var values and secret-like fields are masked; streamed output is redacted for JWTs, access keys and bearer tokens.
- AWS tokens are never read or stored; `AWS_PROFILE` is set only in child environments and other `AWS_*` credential variables are stripped.
- App state (recent projects: path, name, timestamp) lives in `~/.agentcore-gui/recent.json`.

## Layout
`lib/config` (parser → `Graph`), `lib/cli` (allowlist, argv, output parsers), `lib/exec` (spawn, shim unwrapping, redaction, mock), `lib/aws` (profiles, STS, login), `app/api` (routes), `components` (UI). The UI depends only on `Graph` and the API JSON, so CLI/config format changes stay inside `lib/config` and `lib/cli`.

## Known limitations
- Deployed-state and deployed `status --json` shapes are unverified (only `local-only` projects were observable); status parsing is best-effort and the mock's deployed data is invented.
- The CLI itself writes logs/state under `agentcore/.cli/` (even for `status`); this app does not.
- `fetch access` (returns tokens) and `traces get` (writes files) are intentionally excluded, as are `add`/`remove`/`import`/`archive`.
- Python scaffolding needs `uv`; the UI offers TypeScript only.
- Inferred edges (ARN/name matching, naming convention, connector parameters) can be wrong; they are labelled as inferred.
- `aws login` for `login_session` profiles runs without `--remote` (that flag prompts for a pasted code on stdin); it opens a browser on this machine rather than printing a URL.
- `logs` and `traces list` flags come from `--help`; their non-interactive behaviour is unverified against live data.
- Prototype: single user, no auth beyond localhost binding, no persistence beyond the recent-projects list.
