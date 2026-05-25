export type IncidentState =
  | 'RECEIVED'
  | 'TRIAGING'
  | 'DIAGNOSED'
  | 'AWAITING_APPROVAL'
  | 'EXECUTING'
  | 'RESOLVED'
  | 'FAILED'
  | 'REJECTED';

export interface AgentTurn {
  at: string;
  thought: string;
  toolCall?: { name: string; args: Record<string, unknown> };
  toolResult?: { ok: boolean; data: unknown };
}

export interface IncidentRecord {
  id: string;
  receivedAt: string;
  updatedAt: string;
  state: IncidentState;
  problemId: string;
  problemTitle: string;
  affectedEntity: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  agentTurns: AgentTurn[];
  proposedRemediation?: ProposedRemediation;
  approval?: Approval;
  outcome?: RemediationOutcome;
}

export interface ProposedRemediation {
  tool: 'restartPod' | 'rollbackDeployment' | 'scaleService';
  args: Record<string, unknown>;
  rationale: string;
  riskAssessment: 'low' | 'medium' | 'high';
  estimatedBlastRadius: string;
}

export interface Approval {
  decision: 'approve' | 'reject';
  decidedBy: string;
  decidedAt: string;
  modifiedArgs?: Record<string, unknown>;
}

export interface RemediationOutcome {
  success: boolean;
  summary: string;
  durationMs: number;
}
