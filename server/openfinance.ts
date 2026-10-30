/**
 * Integração com Open Finance via agregador (Pluggy). Os bancos brasileiros expõem dados pelo Open Finance
 * apenas a instituições autorizadas pelo Banco Central; agregadores como a Pluggy fazem essa ponte.
 * Sem credenciais configuradas, o servidor responde em modo sandbox com dados simulados.
 */

export interface OFTransaction {
  externalId: string;
  date: string;
  description: string;
  amount: number;
  account: string;
  category?: string;
}

export interface OFSyncResult {
  institution: string;
  mode: "pluggy" | "sandbox";
  transactions: OFTransaction[];
}

const PLUGGY = "https://api.pluggy.ai";

export function openFinanceMode(): "pluggy" | "sandbox" {
  return process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET ? "pluggy" : "sandbox";
}

let cachedKey: { key: string; exp: number } | null = null;

async function pluggyKey(): Promise<string> {
  if (cachedKey && cachedKey.exp > Date.now()) return cachedKey.key;
  const res = await fetch(`${PLUGGY}/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId: process.env.PLUGGY_CLIENT_ID, clientSecret: process.env.PLUGGY_CLIENT_SECRET }),
  });
  if (!res.ok) throw new Error(`Pluggy: falha na autenticação (${res.status})`);
  const { apiKey } = (await res.json()) as { apiKey: string };
  cachedKey = { key: apiKey, exp: Date.now() + 90 * 60 * 1000 };
  return apiKey;
}

async function pluggyGet<T>(path: string): Promise<T> {
  const res = await fetch(`${PLUGGY}${path}`, { headers: { "X-API-KEY": await pluggyKey() } });
  if (!res.ok) throw new Error(`Pluggy: ${path.split("?")[0]} respondeu ${res.status}`);
  return (await res.json()) as T;
}

interface PluggyAccount {
  id: string;
  name: string;
  type: "BANK" | "CREDIT" | string;
}
interface PluggyTx {
  id: string;
  description: string;
  amount: number;
  date: string;
  category?: string | null;
}

async function syncPluggy(itemId: string, from: string): Promise<OFSyncResult> {
  const item = await pluggyGet<{ connector?: { name?: string } }>(`/items/${encodeURIComponent(itemId)}`);
  const accounts = await pluggyGet<{ results: PluggyAccount[] }>(`/accounts?itemId=${encodeURIComponent(itemId)}`);
  const transactions: OFTransaction[] = [];
  for (const acc of accounts.results) {
    for (let page = 1; ; page++) {
      const r = await pluggyGet<{ results: PluggyTx[]; totalPages: number }>(
        `/transactions?accountId=${acc.id}&from=${from}&pageSize=500&page=${page}`,
      );
      for (const t of r.results) {
        // Em conta corrente o sinal já indica débito/crédito; no cartão, valores positivos são compras.
        const amount = acc.type === "CREDIT" ? -t.amount : t.amount;
        transactions.push({ externalId: t.id, date: t.date.slice(0, 10), description: t.description, amount, account: acc.name, category: t.category ?? undefined });
      }
      if (page >= (r.totalPages ?? 1)) break;
    }
  }
  return { institution: item.connector?.name ?? "Instituição", mode: "pluggy", transactions };
}

const SANDBOX_MERCHANTS: [string, number][] = [
  ["PIX ENVIADO - Supermercado Pão Dourado", 320],
  ["COMPRA CARTAO - Posto Shell", 240],
  ["COMPRA CARTAO - iFood", 78],
  ["DEBITO AUT. - Energia elétrica", 255],
  ["COMPRA CARTAO - Drogaria São Paulo", 96],
  ["COMPRA CARTAO - Restaurante Sabor & Arte", 145],
  ["PIX ENVIADO - Estacionamento Centro", 30],
  ["COMPRA CARTAO - Netflix", 55.9],
  ["COMPRA CARTAO - Uber", 32],
  ["COMPRA CARTAO - Cinema Cinemark", 84],
];

function syncSandbox(itemId: string, institution: string, from: string): OFSyncResult {
  let seed = [...itemId].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const start = new Date(`${from}T12:00:00Z`).getTime();
  const days = Math.max(1, Math.round((Date.now() - start) / 86400000));
  const transactions: OFTransaction[] = [];
  for (let i = 0; i < Math.min(60, days * 0.8); i++) {
    const [description, base] = SANDBOX_MERCHANTS[Math.floor(rnd() * SANDBOX_MERCHANTS.length)];
    const date = new Date(start + Math.floor(rnd() * days) * 86400000).toISOString().slice(0, 10);
    transactions.push({
      externalId: `${itemId}-${i}`,
      date,
      description,
      amount: -Math.round(base * (0.7 + rnd() * 0.6) * 100) / 100,
      account: `${institution} • Cartão`,
    });
  }
  return { institution, mode: "sandbox", transactions };
}

export async function syncItem(itemId: string, institution: string, from: string): Promise<OFSyncResult> {
  return openFinanceMode() === "pluggy" ? syncPluggy(itemId, from) : syncSandbox(itemId, institution, from);
}
