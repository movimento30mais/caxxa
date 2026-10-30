import type { Advice } from "../../server/ai";
import type { ImportResult } from "../../server/importXlsx";
import type { OFSyncResult } from "../../server/openfinance";
import type { AiPayload } from "./analytics";

export type { Advice, ImportResult, OFSyncResult };

export interface ServerStatus {
  ai: boolean;
  openFinance: "pluggy" | "sandbox";
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Erro ${res.status}`);
  return body as T;
}

const json = (data: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(data),
});

export interface Session {
  user: string;
  authEnabled: boolean;
}

export const api = {
  me: () => call<Session>("/api/auth/me"),
  login: (username: string, password: string) => call<Session>("/api/auth/login", json({ username, password })),
  logout: () => call<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  status: () => call<ServerStatus>("/api/status"),
  advice: (summary: AiPayload, question?: string) => call<Advice>("/api/ai/advice", json({ summary, question })),
  importXlsx: (file: File) => call<ImportResult>("/api/import/xlsx", { method: "POST", body: file }),
  sync: (itemId: string, institution: string, from: string) => call<OFSyncResult>("/api/openfinance/sync", json({ itemId, institution, from })),
};
