import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile(".env");
} catch {
  /* sem .env: usa as variáveis do ambiente */
}

// Importado depois do .env para que as chaves já estejam no ambiente.
const { default: app } = await import("./app");

// Em produção o mesmo servidor entrega o front-end compilado.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`Caxxa API em http://localhost:${port}`));
