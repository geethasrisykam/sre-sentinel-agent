# ADK migration — orchestrator agent loop

The orchestrator's agent loop now uses the Google Agent Development Kit
(`@google/adk`, the code-first developer surface of Google Cloud Agent Builder)
instead of driving `@google/genai` directly. This satisfies the Rapid Agent
Hackathon qualification rule "agent built with Gemini using Google Cloud Agent
Builder" without changing the external behaviour of the orchestrator.

## What changed

- `AgentRunner` (`packages/orchestrator/src/agent/runner.ts`) now constructs an
  ADK `LlmAgent` with the existing system prompt mapped to ADK's `instruction`
  field, registers three ADK `FunctionTool`s (`getProblem`, `getDeployments`,
  `getLogs`) that delegate to the injected `DiagnosisAdapter`, and drives them
  with an `InMemoryRunner` per incident. Each incident gets a fresh ephemeral
  session so concurrent triages do not share state.
- The runner walks the `runAsync` event stream and maps ADK events back to
  `IncidentRecord.agentTurns`: every event carrying `functionCall` parts emits
  one tool-call turn per call, every event carrying `functionResponse` parts
  fires `onTurn` so the dashboard sees each tool result land, and the final
  text-only event is parsed as the JSON remediation proposal. The
  proposal-attached-before-final-onTurn ordering is preserved.
- `MAX_TURNS` is enforced via ADK's `RunConfig.maxLlmCalls` (set to 6 to match
  the previous behaviour) and the runner detects the ADK error that fires when
  the cap is hit, mapping it to the existing "Diagnosis aborted: …
  6-turn investigation cap" turn so the dashboard summary stays identical.
- `gemini.ts` is gone. `prompt.ts` keeps the system instruction text unchanged.
- The DI shape in `index.ts` is unchanged: `new AgentRunner(apiKey, model,
  diagnosisAdapter)` replaces `new AgentRunner(geminiClient, diagnosisAdapter)`,
  but the constructor still takes a `DiagnosisAdapter` so mock-vs-real
  selection works the same way.

## Hard contract preserved

- `diagnose(incident, onTurn)` signature unchanged.
- `onTurn` fires after every tool execution and once more with the final
  proposal attached.
- Failure modes (`max turns`, `empty response`, `parse error`) still append a
  `Diagnosis aborted: <reason>` turn before returning `null`.
- `routes.test.ts` (the route-level contract) needs no functional change.

## Tests

`runner.test.ts` was rewritten. The previous suite injected a `StubGemini` that
spoke the `@google/genai` `Content`/`Part` protocol; that protocol is now
internal to ADK and not a stable test seam. The new suite injects a stub
`BaseLlm` via ADK's public `LlmAgent({ model: BaseLlm })` API and scripts
`LlmResponse`s the same way — every behaviour the old suite covered (happy
path, code-fence stripping, parse-failure, empty-response, tool-error capture,
adapter routing, MAX_TURNS) is verified.

## Option 2 (future)

When `diagnosisAdapter === 'dynatrace'` we currently still wrap our
`DynatraceMcpAdapter` as ADK function tools. ADK ships `MCPToolset` which can
connect to `@dynatrace-oss/dynatrace-mcp-server` over stdio directly and
expose its native tool surface (`list_problems`, `execute_dql`, etc.) to the
agent — but that surface differs from the `getProblem`/`getDeployments`/
`getLogs` names the system prompt was tuned around, so adopting it requires
prompt rewrites and tool-name remapping. Leaving it as a follow-up.

## Runtime notes

- ADK reads `GEMINI_API_KEY` or `GOOGLE_GENAI_API_KEY` from `process.env` if
  no key is passed explicitly; we pass `apiKey` into `new Gemini(...)` so the
  existing `GEMINI_API_KEY` env var flow is preserved unchanged.
- Vertex AI is not required; ADK defaults to the AI Studio endpoint when given
  a raw API key, which is what we already use. If the user wants to switch to
  Vertex AI later, `Gemini({ vertexai: true, project, location })` is the knob.
- No new runtime deps beyond `@google/adk` itself. ADK has no Python
  dependency.
