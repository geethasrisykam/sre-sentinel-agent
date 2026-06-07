# SRE Sentinel — Submission writeup

> An autonomous incident-triage agent that turns 2 a.m. Dynatrace alerts into 90-second, human-approved resolutions.

**Hackathon:** Google Cloud Rapid Agent Hackathon
**Partner track:** Dynatrace
**Submission date:** 2026-06-12
**Repo:** https://github.com/geethasrisykam/sre-sentinel-agent

## The problem

When a production incident fires at 02:00, the on-call engineer spends most of their time on the *boring* part: pulling logs, correlating deploys, identifying the affected entity, choosing between three obvious remediations (restart, rollback, scale). The judgement call — should we actually do this? — takes seconds. The plumbing takes minutes.

SRE Sentinel inverts that ratio. The agent does the diagnosis work upfront. The human spends five seconds on the only decision that matters.

## How it works

```
┌─────────────────────────────────────────────────────────────────────┐
│  Dashboard (React + Vite + Tailwind)                                │
│  • Live SSE incident stream (every agent turn streams in real-time) │
│  • Reasoning timeline + approval gate with arg editor               │
│  Hosted: Fly.io (combined deploy) or Firebase Hosting + Cloud Run   │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ HTTP + Server-Sent Events
┌──────────────────────▼──────────────────────────────────────────────┐
│  Orchestrator (Fastify + TypeScript)                                │
│  • Dynatrace webhook ingress (HMAC bearer-token auth)               │
│  • Gemini 2.5 agent loop via @google/genai function-calling         │
│  • Per-turn SQLite audit log + in-process event bus                 │
│  • Approval gate; remediation only fires on explicit approval       │
└──────────┬──────────────────────────────────┬───────────────────────┘
           │                                  │
┌──────────▼─────────────────────┐  ┌─────────▼─────────────────────┐
│ Diagnosis Adapter              │  │ Remediation MCP (custom)      │
│ • Mock (in-process fixtures)   │  │ • restartPod      [REAL/MOCK] │
│ • Dynatrace MCP (real tenant)  │  │ • rollbackDeployment  [MOCK]  │
│   via npx + stdio transport    │  │ • scaleService        [MOCK]  │
└────────────────────────────────┘  └───────────────────────────────┘
```

When a Dynatrace problem fires:

1. **Orchestrator validates** the webhook (bearer token) and creates an incident record in state `TRIAGING`.
2. **Gemini agent loop** runs — the model decides which Dynatrace MCP tools to call (`getProblem`, `getDeployments`, `getLogs`) and synthesises evidence. Each turn streams to the dashboard in real time.
3. **The agent emits a structured proposal** — one remediation tool, args, rationale citing concrete evidence, risk, blast radius. State → `AWAITING_APPROVAL`.
4. **The operator** sees the full reasoning, can edit the args, and approves with one click. Or rejects.
5. **The custom Remediation MCP** executes the approved action. State → `RESOLVED` or `FAILED`.
6. **Every step is persisted** to the SQLite audit log and replayed in the dashboard's reasoning timeline.

End-to-end measured on the live demo: **6–10 seconds** from webhook to `AWAITING_APPROVAL`. The operator decision adds 5 seconds. Remediation completes in another 4 seconds. **Total: under 20 seconds** vs the typical 5-minute manual flow.

## Key design decisions

| Decision | Why |
|---|---|
| **Action over chat** | Every agent turn ends in a tool call or a structured proposal. No free-form essays. Hard rule in the system prompt, enforced by the JSON parsing step. |
| **Human-in-the-loop, always** | No remediation executes without explicit approval. The approval payload is signed (HMAC session cookie) and audited. |
| **Diagnosis-first ordering** | The system prompt requires the agent to call at least one diagnosis tool before proposing a remediation. Reduces hallucination, forces evidence-grounded reasoning. |
| **Mock + real adapter parity** | The `DiagnosisAdapter` interface lets the agent run against in-process fixtures (no Dynatrace billing burned during dev) or against a real Dynatrace tenant via the official `@dynatrace-oss/dynatrace-mcp-server`. Same agent code; one config flip. |
| **Server-Sent Events** | Per-turn persistence + SSE push means the dashboard reasoning timeline fills in *as the agent works* — judges see the model thinking, not a black box. Single EventSource via React context; no polling. |
| **SQLite + event bus** | Zero-config persistence for dev. Repository emits events to an in-process bus; SSE subscribers consume them. Same data model migrates 1:1 to Firestore for production. |
| **Two ingress paths** | `/api/incidents` (session-auth) for the dashboard's simulate-alert buttons; `/api/webhooks/dynatrace` (bearer-token auth) for real Dynatrace. Same triage pipeline. |
| **Two deploy paths** | Cloud Run + Firebase Hosting (original architecture) and Fly.io single-image (backup). Both work; pick whichever billing is friendlier. |

## What we deliberately did not build

- **No multi-agent debate.** One agent with five well-scoped tools is faster and more demoable than five agents arguing.
- **No custom vector RAG.** The Dynatrace MCP already provides grounded context. Adding RAG would be pure scope creep.
- **No real Kubernetes integration.** The `restartPod` REAL target is a sacrificial Cloud Run service — visually identical for a demo, operationally safe.
- **No multi-tenant auth.** A single shared demo password is right for a hackathon submission and easy to swap for OAuth later.

## What's actually running in the demo

- **Orchestrator:** Node 20, Fastify 4, TypeScript strict mode, 42 vitest tests covering the event bus, repository, agent loop, and HTTP routes
- **Dashboard:** React 18, Vite 5, Tailwind 3, EventSource-driven (no polling), context-shared stream
- **Remediation MCP:** Official `@modelcontextprotocol/sdk` server over stdio, three tools with realistic mocked execution timings
- **Diagnosis:** Mock by default (5 seeded problems covering restart / rollback / scale paths); Dynatrace MCP adapter scaffolded behind a feature flag for the live tenant

## How to evaluate

1. **Watch the 90-second demo video** (linked in repo README)
2. **Try it yourself** at `<HOSTED_URL>` — log in with the demo password, click any seeded problem, watch the reasoning timeline fill in, approve a remediation
3. **Read the code** — `packages/orchestrator/src/agent/runner.ts` is the heart of it (~140 lines); `packages/orchestrator/src/routes.ts` is the HTTP surface
4. **Read the tests** — `packages/orchestrator/src/routes.test.ts` shows the full webhook → approve → resolve flow under Fastify inject

## What I learned

- **Streaming the agent's reasoning matters more than I expected.** A 7-second triage feels instant when you can watch each tool call land. Before SSE, the same 7 seconds felt like a "black box hang."
- **MCP as a transport gives real architectural leverage.** The Dynatrace MCP server's tool surface differs significantly from my internal mock, but a thin adapter layer translates between them cleanly. Same pattern works for the custom Remediation MCP.
- **The hardest review finding wasn't a bug — it was a UX flash.** The agent attached its final proposal *after* publishing the "Final remediation proposed" turn, causing a 1-frame state where the dashboard showed "no proposal yet" right next to "agent is done." Fixed by attaching the proposal first; would have shipped without an external code review.

## Stack

| Layer | Tech |
|---|---|
| LLM | Gemini 2.5 Flash via `@google/genai` (function calling) |
| Orchestrator | Node 20, Fastify 4, `@fastify/cookie`, `@fastify/static`, Zod, better-sqlite3 |
| MCP | `@modelcontextprotocol/sdk` (client for diagnosis + remediation, server for custom remediation) |
| Dashboard | React 18, Vite 5, Tailwind 3, EventSource |
| Tests | Vitest 2 (42 tests, all in-memory) |
| Hosting | Fly.io (combined) or Cloud Run + Firebase Hosting (split) |

## Repo layout

```
sre-sentinel/
├── packages/
│   ├── shared/              # Types shared across workspaces
│   ├── orchestrator/        # Fastify backend, webhook ingress, agent client, SSE
│   ├── remediation-mcp/     # Custom MCP server (restart/rollback/scale)
│   └── dashboard/           # React + Vite operator UI
├── infra/
│   ├── orchestrator/        # Dockerfile, Cloud Run service.yaml, fly.toml
│   ├── dashboard/           # firebase.json
│   └── README.md            # Full cold-start deploy runbook
└── docs/
    ├── ARCHITECTURE.md      # Design principles, state machine, schemas
    ├── DEMO.md              # 90-second screencast script
    └── SUBMISSION.md        # This file
```

## License

Apache 2.0
