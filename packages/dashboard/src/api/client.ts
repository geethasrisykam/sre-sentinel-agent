import type { IncidentRecord } from '@sre-sentinel/shared';

export interface SeededProblem {
  problemId: string;
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export class AuthRequiredError extends Error {
  constructor() {
    super('authentication required');
    this.name = 'AuthRequiredError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  async login(password: string): Promise<void> {
    await request<{ ok: true }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },

  async logout(): Promise<void> {
    await request<{ ok: true }>('/api/auth/logout', { method: 'POST' });
  },

  async listIncidents(): Promise<IncidentRecord[]> {
    const { incidents } = await request<{ incidents: IncidentRecord[] }>('/api/incidents');
    return incidents;
  },

  async getIncident(id: string): Promise<IncidentRecord> {
    return request<IncidentRecord>(`/api/incidents/${id}`);
  },

  async listSeededProblems(): Promise<SeededProblem[]> {
    const { problems } = await request<{ problems: SeededProblem[] }>('/api/seeded-problems');
    return problems;
  },

  async fireWebhook(problemId: string): Promise<{ id: string; state: string }> {
    return request<{ id: string; state: string }>('/api/incidents', {
      method: 'POST',
      body: JSON.stringify({ problemId }),
    });
  },

  async decide(
    incidentId: string,
    decision: 'approve' | 'reject',
    decidedBy: string,
    modifiedArgs?: Record<string, unknown>,
  ): Promise<{ ok: true; state: string }> {
    return request<{ ok: true; state: string }>(`/api/incidents/${incidentId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ decision, decidedBy, modifiedArgs }),
    });
  },
};
