// Abstraction over the diagnosis tool surface the agent calls during triage.
// Two implementations exist today: an in-process mock (mock-diagnosis.ts) and
// a real Dynatrace MCP client (dynatrace-mcp-adapter.ts). The agent runner
// receives one via DI, so swapping between them is purely a config decision.

export interface GetProblemArgs {
  problemId: string;
}
export interface GetDeploymentsArgs {
  entityId: string;
  lookbackMinutes: number;
}
export interface GetLogsArgs {
  entityId: string;
  sinceMinutes: number;
  limit: number;
}

export interface DiagnosisAdapter {
  // The agent loop JSON-serializes whatever each method returns and feeds it
  // back to Gemini as a functionResponse, so the shape only matters insofar
  // as the model can reason about it. Each adapter is responsible for
  // returning something useful — usually a structured object for the mock,
  // and whatever the MCP tool returned for the real client.
  getProblem(args: GetProblemArgs): Promise<unknown>;
  getDeployments(args: GetDeploymentsArgs): Promise<unknown>;
  getLogs(args: GetLogsArgs): Promise<unknown>;

  // Optional lifecycle hooks. Implementations that spawn external processes
  // (the Dynatrace MCP client) implement these; the in-process mock does not.
  connect?(): Promise<void>;
  close?(): Promise<void>;
}
