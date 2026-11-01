import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { AiRefusal, aiAvailable, getAdvice } from "./ai";
import { currentUser, login, logout, me, requireAuth, signup } from "./auth";
import { dataStore } from "./dataStore";
import { importCashflowXlsx } from "./importXlsx";
import { openFinanceMode, syncItem } from "./openfinance";

/** Rotas da API. Usado pelo servidor local (server/index.ts) e pela função serverless da Vercel. */
const app = express();
app.use(express.json({ limit: "4mb" }));

app.post("/api/auth/login", login);
app.post("/api/auth/signup", signup);
app.post("/api/auth/logout", logout);
app.get("/api/auth/me", me);
// Daqui para baixo, só com sessão válida (quando AUTH_USERS está configurado).
app.use("/api", requireAuth);

app.get("/api/status", (_req, res) => {
  res.json({ ai: aiAvailable(), openFinance: openFinanceMode(), cloudSync: dataStore() !== null });
});

// Dados do usuário logado, guardados no servidor para acompanharem o login em qualquer aparelho.
app.get("/api/data", async (req, res) => {
  const store = dataStore();
  const user = currentUser(req);
  if (!store || !user || user === "local") {
    res.status(404).json({ error: "Sem armazenamento no servidor." });
    return;
  }
  const saved = await store.load(user);
  if (saved) res.json(saved);
  else res.status(404).json({ error: "Nenhum dado salvo ainda." });
});

// PUT pelo app; POST via navigator.sendBeacon quando o app vai para segundo plano.
const saveData = async (req: express.Request, res: express.Response) => {
  const store = dataStore();
  const user = currentUser(req);
  if (!store || !user || user === "local") {
    res.status(404).json({ error: "Sem armazenamento no servidor." });
    return;
  }
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const updatedAt = Number(body?.updatedAt);
  const state = body?.state as { version?: number } | undefined;
  if (!Number.isFinite(updatedAt) || !state || state.version !== 1) {
    res.status(400).json({ error: "Dados inválidos." });
    return;
  }
  // Não deixa um aparelho com dados mais antigos sobrescrever os mais novos.
  const current = await store.load(user);
  if (current && current.updatedAt > updatedAt) {
    res.status(409).json(current);
    return;
  }
  await store.save(user, { updatedAt, state });
  res.json({ ok: true, updatedAt });
};
app.put("/api/data", express.json({ limit: "4mb" }), saveData);
app.post("/api/data", express.text({ type: () => true, limit: "4mb" }), saveData);

app.post("/api/ai/advice", async (req, res) => {
  if (!aiAvailable()) {
    res.status(503).json({ error: "IA não configurada: defina ANTHROPIC_API_KEY no servidor." });
    return;
  }
  try {
    res.json(await getAdvice(req.body?.summary, req.body?.question));
  } catch (err) {
    if (err instanceof AiRefusal) res.status(422).json({ error: err.message });
    else if (err instanceof Anthropic.RateLimitError) res.status(429).json({ error: "Limite de uso da IA atingido. Tente em instantes." });
    else if (err instanceof Anthropic.AuthenticationError) res.status(502).json({ error: "Chave da API da Anthropic inválida." });
    else if (err instanceof Anthropic.APIError) res.status(502).json({ error: `Erro da IA (${err.status ?? "rede"}).` });
    else res.status(500).json({ error: err instanceof Error ? err.message : "Erro inesperado." });
  }
});

app.post("/api/import/xlsx", express.raw({ type: () => true, limit: "15mb" }), async (req, res) => {
  try {
    const buf = req.body as Buffer;
    const result = await importCashflowXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, String(req.query.sheet ?? "Fluxo de Caixa (2)"));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Não foi possível ler a planilha." });
  }
});

app.post("/api/openfinance/sync", async (req, res) => {
  const { itemId, institution, from } = req.body ?? {};
  if (typeof itemId !== "string" || !itemId || typeof from !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    res.status(400).json({ error: "Informe itemId e from (AAAA-MM-DD)." });
    return;
  }
  try {
    res.json(await syncItem(itemId, String(institution ?? "Banco"), from));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Falha ao sincronizar." });
  }
});

export default app;
