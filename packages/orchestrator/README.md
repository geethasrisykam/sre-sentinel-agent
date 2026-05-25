# @sre-sentinel/orchestrator

The brain of SRE Sentinel. Receives Dynatrace alerts, drives Gemini through a
diagnosis + proposal loop, gates remediation behind human approval, and persists
every step to SQLite.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/login` | Exchange the demo password for a session cookie |
| `POST` | `/api/incidents` | Dynatrace webhook — kicks off agent triage |
| `GET`  | `/api/incidents` | List incidents (newest first) |
| `GET`  | `/api/incidents/:id` | Full incident record incl. agent turns |
| `POST` | `/api/incidents/:id/approve` | Approve / reject / modify the proposed remediation |
| `GET`  | `/healthz` | Liveness check |

## Run locally

```powershell
# From repo root, after `npm install`
Copy-Item .env.example .env.local   # if you haven't already
# Edit .env.local: GEMINI_API_KEY = your AI Studio key, DASHBOARD_DEMO_PASSWORD = pick anything
npm run dev:orchestrator
```

Server starts on `http://localhost:8080`. SQLite database lives at
`packages/orchestrator/data/sentinel.db` (gitignored).

## How the agent loop runs

1. Webhook receives a Dynatrace problem payload (real or simulated).
2. Orchestrator persists `IncidentRecord` with state `TRIAGING`.
3. `AgentRunner` calls Gemini with:
   - The system prompt (incident-commander persona, hard guardrails)
   - The problem context as the user message
   - Function declarations for diagnosis tools (`getProblem`, `getDeployments`, `getLogs`)
4. Gemini may call one or more diagnosis tools across turns; the orchestrator
   resolves each call against the **mock diagnosis adapter** (Phase 3) — this
   is swapped for the real Dynatrace MCP server in Phase 4 without changing
   the runner.
5. When Gemini stops calling tools, it emits a final structured proposal:
   `{ tool, args, rationale, riskAssessment, estimatedBlastRadius }`.
6. State moves to `AWAITING_APPROVAL`. Dashboard shows the proposal.
7. Operator approves → orchestrator calls the **Remediation MCP server**
   (spawned as a child process via stdio) with the approved args.
8. Outcome is persisted; state moves to `RESOLVED` or `FAILED`.

The audit log captures every agent turn (thought, tool call, tool result) so
the dashboard can replay the timeline for the judges.

## Why mocked diagnosis in Phase 3

The Dynatrace MCP server lives behind a 15-day trial — activating it on Day 3
of a 19-day hackathon would burn the trial before submission. The mock
adapter in `src/agent/mock-diagnosis.ts` uses the same function signatures the
real MCP exposes (`listProblems`, `getProblem`, `getDeployments`, `getLogs`),
so the swap in Phase 4 is purely a transport change.

## Auth model

Single shared password set via `DASHBOARD_DEMO_PASSWORD` env var. `POST /api/auth/login`
sets an HTTP-only session cookie signed with `DASHBOARD_SESSION_SECRET`. Every
non-auth, non-health route requires that cookie. Sufficient for a hackathon
demo; not production-grade.
