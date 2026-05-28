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

// Base URL the dashboard uses for orchestrator requests. In dev, leave empty
// so paths stay relative and Vite's /api proxy applies. In production behind
// Firebase Hosting, also leave empty — firebase.json rewrites /api/** to the
// Cloud Run service, keeping requests same-origin. Set VITE_API_BASE_URL only
// when you need to point a build at a different orchestrator (e.g. a preview).
export const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  return apiBase ? `${apiBase}${path}` : path;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
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

  async clearAllIncidents(): Promise<{ ok: true; deleted: number }> {
    return request<{ ok: true; deleted: number }>('/api/incidents', {
      method: 'DELETE',
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
