# @sre-sentinel/remediation-mcp

Custom MCP server that exposes three remediation tools to the SRE Sentinel agent.

| Tool | Default mode | What it does |
|---|---|---|
| `restartPod` | `MOCK` | Restart a service instance. In `REAL` mode, redeploys a target Cloud Run revision. |
| `rollbackDeployment` | `MOCK` | Roll a service back to the previous successful deployment. |
| `scaleService` | `MOCK` | Increase or decrease replicas for a service. |

Each tool returns a structured `RemediationToolResult` that the agent can reason about in its next turn.

## Run locally

```powershell
# From repo root, after `npm install`
npm run dev:remediation-mcp
```

The server starts on **stdio**, which is what MCP clients like the official Inspector expect.

## Inspect with the MCP Inspector

```powershell
# From this package directory
npm run inspect
```

Opens the MCP Inspector in your browser. You can:
- See the three registered tools and their input schemas
- Call them with sample arguments
- Watch structured responses come back

This is the fastest way to validate the MCP server works without touching the agent.

## Configuration

All settings are environment variables. See the repo-root `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `REMEDIATION_RESTART_POD_MODE` | `MOCK` | `MOCK` or `REAL` |
| `REMEDIATION_ROLLBACK_MODE` | `MOCK` | `MOCK` or `REAL` |
| `REMEDIATION_SCALE_MODE` | `MOCK` | `MOCK` or `REAL` |
| `VICTIM_APP_SERVICE_NAME` | _empty_ | Cloud Run service name targeted by `restartPod` in `REAL` mode |
| `VICTIM_APP_REGION` | `us-central1` | GCP region for the victim app |

## Switching `restartPod` to `REAL` mode

`REAL` mode is wired up but no-ops with a clear log message until you also supply GCP credentials and a `VICTIM_APP_SERVICE_NAME`. This is intentional so the server works end-to-end on a free development machine.
