import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { AiRefusal, aiAvailable, getAdvice } from "./ai";
import { importCashflowXlsx } from "./importXlsx";
import { openFinanceMode, syncItem } from "./openfinance";

try {
  process.loadEnvFile(".env");
} catch {
  /* sem .env: usa as variáveis do ambiente */
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/api/status", (_req, res) => {
  res.json({ ai: aiAvailable(), openFinance: openFinanceMode() });
});

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

app.post("/api/import/xlsx", express.raw({ type: "*/*", limit: "15mb" }), async (req, res) => {
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

// Em produção o mesmo servidor entrega o front-end compilado.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`Caxxa API em http://localhost:${port}`));
