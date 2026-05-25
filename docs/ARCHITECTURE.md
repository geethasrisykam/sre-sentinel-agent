# Architecture

## Design principles

1. **Action over chat.** Every agent turn must end in a tool call, a remediation proposal, or a status update — never a free-form essay.
2. **Human-in-the-loop, always.** No remediation executes without explicit approval. The approval payload is signed and audited.
3. **Diagnosis-first ordering.** The agent must call at least two Dynatrace MCP tools before proposing a remediation. This is enforced via the agent prompt and the orchestrator's state machine.
4. **Hybrid remediation surface.** `restartPod` is a real action against a sacrificial Cloud Run service; `rollbackDeployment` and `scaleService` are mocked with realistic timing so the demo stays safe.
5. **Zero billing path for development.** Use Google AI Studio's free Gemini tier and SQLite locally so a developer can run the full stack without GCP billing activated.

## State machine

Each incident moves through these states. The state is persisted to the audit log after every transition.

```
RECEIVED
  ↓ (orchestrator validates webhook)
TRIAGING
  ↓ (agent calls Dynatrace MCP for context)
DIAGNOSED
  ↓ (agent proposes remediation)
AWAITING_APPROVAL
  ↓ (operator approves)         ↓ (operator rejects)
EXECUTING                       REJECTED
  ↓ (remediation MCP responds)
RESOLVED / FAILED
```

## Audit log schema (SQLite dev, Firestore prod)

```typescript
interface IncidentRecord {
  id: string;
  receivedAt: string;
  state: 'RECEIVED' | 'TRIAGING' | 'DIAGNOSED' | 'AWAITING_APPROVAL'
       | 'EXECUTING' | 'RESOLVED' | 'FAILED' | 'REJECTED';
  problemId: string;
  problemTitle: string;
  affectedEntity: string;
  agentTurns: AgentTurn[];
  proposedRemediation?: {
    tool: 'restartPod' | 'rollbackDeployment' | 'scaleService';
    args: Record<string, unknown>;
    rationale: string;
    riskAssessment: 'low' | 'medium' | 'high';
  };
  approval?: {
    decision: 'approve' | 'reject';
    decidedBy: string;
    decidedAt: string;
  };
  outcome?: {
    success: boolean;
    summary: string;
    durationMs: number;
  };
}

interface AgentTurn {
  at: string;
  thought: string;
  toolCall?: { name: string; args: Record<string, unknown> };
  toolResult?: { ok: boolean; data: unknown };
}
```

## Why this stack

- **Node + TypeScript everywhere** — the MCP SDK is TypeScript-first, the frontend is React, and unifying the language reduces context-switching for a solo developer on a 19-day deadline.
- **Fastify** over Express — better TypeScript support, schema validation built in, faster cold starts on Cloud Run.
- **Vite + React** for the dashboard — sub-second HMR is essential when iterating on the approval UX, which is the single most visible part of the demo.
- **SQLite (better-sqlite3) for dev** — zero config, file-based, runs without billing. Swappable for Firestore in production via a `Repository` interface.
- **Agent Builder (managed)** for the agent runtime — we don't need to host an agent process; Google does that. Our code just exposes tools and a webhook.

## What we are deliberately NOT building

- No multi-agent debate / consensus. One agent with five tools beats five agents arguing for a 3-minute demo.
- No custom vector RAG. The Dynatrace MCP server already provides grounded context — adding RAG is pure scope creep.
- No real Kubernetes integration. The "real" restart target is a sacrificial Cloud Run service, which is just as visually convincing in a demo without the operational risk.
- No multi-tenant auth. Single shared demo password is sufficient for the hackathon and easy to remove if we productionize later.
