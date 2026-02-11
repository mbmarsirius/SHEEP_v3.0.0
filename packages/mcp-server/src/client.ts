/**
 * SHEEP Cloud API Client
 *
 * Thin HTTP wrapper for the SHEEP cloud API.
 * Uses native fetch -- no extra dependencies.
 */

const DEFAULT_API_URL = "https://sheep-cloud-production.up.railway.app";

export interface SheepClientConfig {
  apiKey: string;
  apiUrl?: string;
}

export interface SheepFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  isActive?: boolean;
  createdAt?: string;
}

export class SheepClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: SheepClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json() as Record<string, unknown>;

    if (!res.ok) {
      const msg = (json.message as string) ?? (json.error as string) ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }

    return json as T;
  }

  // =========================================================================
  // API Methods
  // =========================================================================

  async remember(subject: string, predicate: string, object: string, confidence?: number) {
    return this.request<{ ok: boolean; fact: SheepFact }>("POST", "/v1/remember", {
      subject,
      predicate,
      object,
      confidence,
    });
  }

  async recall(query: string, type?: "facts" | "episodes" | "all", limit?: number) {
    return this.request<{ ok: boolean; query: string; facts?: SheepFact[] }>(
      "POST",
      "/v1/recall",
      { query, type, limit },
    );
  }

  async why(effect: string, maxDepth?: number) {
    return this.request<{
      ok: boolean;
      effect: string;
      chain: Array<{ cause: string; effect: string; mechanism: string; confidence: number }>;
      message?: string;
    }>("POST", "/v1/why", { effect, maxDepth });
  }

  async forget(params: { topic?: string; factId?: string }) {
    return this.request<{ ok: boolean; forgotten: number }>("POST", "/v1/forget", params);
  }

  async facts(limit?: number) {
    const qs = limit ? `?limit=${limit}` : "";
    return this.request<{ ok: boolean; count: number; total: number; facts: SheepFact[] }>(
      "GET",
      `/v1/facts${qs}`,
    );
  }

  async status() {
    return this.request<{
      ok: boolean;
      userId: string;
      tier: string;
      memory: {
        episodes: number;
        facts: number;
        causalLinks: number;
        procedures: number;
        avgConfidence?: number;
        lastConsolidation?: string;
      };
    }>("GET", "/v1/status");
  }

  async health() {
    const res = await fetch(`${this.baseUrl}/health`);
    return res.json() as Promise<{ status: string; service: string; version: string }>;
  }
}
