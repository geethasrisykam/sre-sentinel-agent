# SRE Sentinel

> An autonomous incident-triage agent that turns 2am Dynatrace alerts into 90-second, human-approved resolutions.

Built for the **Google Cloud Rapid Agent Hackathon** (Dynatrace partner track).

## What it does

When a Dynatrace problem fires:

1. **Sentinel ingests the alert** via webhook into the orchestrator service.
2. **Gemini 3 (on Google Cloud Agent Builder)** plans the diagnosis.
3. The agent calls the **Dynatrace MCP server** to correlate problems, traces, logs, and recent deployments.
4. The agent produces a root-cause hypothesis and proposes a remediation (restart pod, rollback deploy, or scale service).
5. The **on-call engineer approves or rejects** in the dashboard — one click.
6. On approval, the agent invokes the **custom Remediation MCP server** to execute the fix.
7. Every step is captured in an audit log and replayed in the reasoning timeline.

The agent does the triage work upfront so the human only spends 5 seconds on the decision that requires judgement.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard (React + Vite + TypeScript)                      │
│  Live problem feed · Reasoning timeline · Approval modal    │
│  Hosted: Firebase Hosting                                   │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST + SSE
┌──────────────────────▼──────────────────────────────────────┐
│  Orchestrator (Node + Fastify + TypeScript)                 │
│  • Dynatrace webhook ingress                                │
│  • Vertex AI / Agent Builder client                         │
│  • SQLite (dev) / Firestore (prod) audit log                │
│  • Approval gate with SSE stream                            │
│  Hosted: Cloud Run                                          │
└──────────┬──────────────────────────┬───────────────────────┘
           │                          │
┌──────────▼─────────────┐  ┌─────────▼────────────────────┐
│ Dynatrace MCP server   │  │ Remediation MCP (custom)     │
│ (official, via npx)    │  │ • restartPod      [REAL]     │
│ • listProblems         │  │ • rollbackDeploy  [MOCKED]   │
│ • getProblem           │  │ • scaleService    [MOCKED]   │
│ • getEntity            │  │ Hosted: Cloud Run            │
│ • getLogs              │  └──────────────────────────────┘
│ • getDeployments       │
└────────────────────────┘
           ▲
           │
┌──────────┴──────────────────────────────────────────────────┐
│  Google Cloud Agent Builder + Gemini 3                      │
│  Managed orchestration, tool calling, reasoning             │
└─────────────────────────────────────────────────────────────┘
```

## Repository layout

```
sre-sentinel/
├── packages/
│   ├── shared/              # Types shared across workspaces
│   ├── orchestrator/        # Fastify backend, webhook + agent client
│   ├── remediation-mcp/     # Custom MCP server with remediation tools
│   └── dashboard/           # React + Vite frontend
├── infra/                   # Deployment configs (Cloud Run, Firebase)
├── docs/                    # Architecture deep-dives
└── .env.example             # Copy to .env.local, fill in keys
```

## Quickstart (development)

Prerequisites: **Node 20+**, **npm 10+**, **Git**, and a free **Google AI Studio API key** (no billing required) from [aistudio.google.com](https://aistudio.google.com).

```powershell
# 1. Install workspace dependencies (run from repo root)
npm install

# 2. Copy environment template and fill in GEMINI_API_KEY
Copy-Item .env.example .env.local
# Edit .env.local and paste your AI Studio API key

# 3. Run each service in its own terminal
npm run dev:orchestrator
npm run dev:remediation-mcp
npm run dev:dashboard
```

The dashboard runs at `http://localhost:5173`, the orchestrator at `http://localhost:8080`, the remediation MCP at `http://localhost:8081`.

## Partner integration: Dynatrace MCP

SRE Sentinel uses the official Dynatrace MCP server (run via `npx`) for all observability data. The agent calls these tools during diagnosis:

| Tool | Used for |
|---|---|
| `listProblems` | Discover active incidents matching the alert window |
| `getProblem` | Pull full context for the firing problem |
| `getEntity` | Resolve affected service / host / process group |
| `getLogs` | Sample recent logs from the affected entity |
| `getDeployments` | Correlate the incident with recent deployments — the most common root cause |

## Roadmap

See the project board. Submission target: **2026-06-12**.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
