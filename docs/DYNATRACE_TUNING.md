# Dynatrace MCP Adapter Tuning Notes

Status: tuned against the v1.8.6 source of `@dynatrace-oss/dynatrace-mcp-server`. Live-tenant validation is blocked on a token-type mismatch (see "Open follow-ups" below).

## Real tool surface (vs the assumed surface)

The previous `DynatraceMcpAdapter` placeholder used a guessed shape (`problem_filter`, `query` parameter for `execute_dql`). The real MCP server exposes the following tool names and parameters — confirmed by reading the bundled `index.js` of the published package and corroborated against the README:

| Tool we use | Real parameters | Notes |
| --- | --- | --- |
| `list_problems` | `timeframe`, `status`, `additionalFilter`, `maxProblemsToDisplay` | Returns a templated **text** response, not JSON. We bypass it for the structured record. |
| `execute_dql` | `dqlStatement`, `recordLimit`, `recordSizeLimitMB` | Parameter is `dqlStatement`, NOT `query`. Returns text content AND `_meta.records` — we read `_meta.records` first. |
| `find_entity_by_name` | `entityNames`, `maxEntitiesToDisplay`, `extendedSearch` | Reserved for future use; the adapter is keyed on entityIds today. |
| `get_kubernetes_events` | `timeframe`, `clusterId`, `kubernetesEntityId`, `eventType` | Considered for deployments but `execute_dql` against `events` is more general. |

Other tools we did not wire (`list_vulnerabilities`, `list_exceptions`, `chat_with_davis_copilot`, `verify_dql`, `generate_dql_from_natural_language`, `send_slack_message`, `send_email`, `send_event`, `create_workflow_for_notification`, `list_davis_analyzers`, `execute_davis_analyzer`, `create_dynatrace_notebook`, `reset_grail_budget`) are visible but out of scope for the diagnosis adapter.

## DQL queries we settled on

All three adapter methods now issue **DQL via `execute_dql`** rather than mixing tool surfaces. This gives one consistent extraction path (`_meta.records`).

- **getProblem** → `fetch dt.davis.problems, from: now()-72h, to: now() | filter event.id == "<id>" or problem_id == "<id>" or display_id == "<id>" | fields … | limit 1`
  - Triple-matches because Dynatrace exposes the same problem under three id flavors: the long UUID `event.id`/`problem_id`, the short display id (`P-xxxx-...`), and a numeric internal id. The agent doesn't know which one it has.
  - Returns the single matching record, or a structured `{error, problemId}` envelope on miss so the agent can degrade.
- **getDeployments** → `fetch events, from: now()-<N>m, to: now() | filter event.kind == "CUSTOM_DEPLOYMENT" | filter in("<entityId>", affected_entity_ids) or dt.entity.service == … or dt.entity.host == … | sort timestamp desc | limit 10`
  - `CUSTOM_DEPLOYMENT` is the canonical kind emitted by the v2 Events API's deployment integrations.
  - We `OR` across multiple entity-id columns because a SERVICE-xxxx vs HOST-xxxx id lives on a different column and we don't want the wrong filter to silently return nothing.
- **getLogs** → `fetch logs, from: now()-<N>m, to: now() | filter dt.entity.service == … or dt.entity.host == … or dt.entity.process_group == … or dt.entity.kubernetes_workload == … | sort timestamp desc | limit <N>`
  - Same OR-across-entity-columns logic as `getDeployments`.
  - We project a fixed set of fields so the agent gets predictable columns: `timestamp`, `status`, `loglevel`, `content`, `dt.entity.*`, `k8s.*`.

DQL string interpolation: `escapeDqlString()` strips quotes/backslashes defensively. Entity ids and problem ids from Dynatrace are ASCII-safe in practice, but the agent might one day forward something hand-typed.

## Tenant data gaps

This trial tenant (`https://zro97929.apps.dynatrace.com`) is a fresh activation as of 2026-06-08. We expect it to have:

- **No deployment events** until the user wires an integration or fires a `send_event` from CI.
- **No service-scoped logs** until a OneAgent is installed somewhere ingesting telemetry.
- **No `dt.davis.problems` records** until something fails or a problem is manufactured.

That's fine. The queries are designed to **parse and execute cleanly** even when the result set is empty — `getProblem` returns a structured "not found" object, `getDeployments` and `getLogs` return `{ deployments: [] }` / `{ logs: [] }` envelopes.

## Open follow-ups

1. **Token type mismatch — BLOCKS live validation.** The token in `.env.local` (`dt0c01.…`) is a **classic API Token**. The official Dynatrace MCP only speaks Bearer auth and requires a **Platform Token** (`dt0s16.…`) or an OAuth client. Symptom: the MCP exits during its startup connection check with `Could not parse JWT. HTTP 401`. Resolution: mint a Platform Token at `{tenant}/ui/apps/dynatrace.platform.management.tokens` with the scopes listed below, then drop it into `.env.local`. The probe script (`packages/orchestrator/scripts/dynatrace-probe.mjs`) detects the `dt0c01.` prefix and prints a warning before attempting connection so this isn't a silent failure.
2. **Required Platform Token scopes** (subset taken from the MCP README — these are the ones our three methods actually need):
   - `app-engine:apps:run` (almost every tool)
   - `storage:buckets:read`
   - `storage:events:read` (`list_problems`, `get_kubernetes_events`, `execute_dql` over `events`)
   - `storage:logs:read` (`execute_dql` over `logs`)
   - `storage:entities:read` (`execute_dql` over `dt.entity.*`)
   - `storage:system:read` (`execute_dql` over `dt.davis.problems`)
3. **Node 22.10+ required.** The MCP bundles a recent `undici` that calls `webidl.util.markAsUncloneable`, which doesn't exist on Node 20. The orchestrator's Cloud Run image must use Node 22; the dev environment must too. The adapter doesn't enforce this — it surfaces the crash through the StdioClientTransport's "Connection closed" error.
4. **Once the token is fixed, re-run the probe** (`node --env-file=.env.local packages/orchestrator/scripts/dynatrace-probe.mjs`) to confirm `tools/list` reports the expected surface and that the four sample DQL probes execute (even with empty result sets). The probe writes a postmortem dump to `packages/orchestrator/scripts/.dynatrace-probe-output.json` (gitignored) for review.
