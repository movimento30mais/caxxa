// Gera .vercel/output (Build Output API v3): front estático + a API Express como uma função Node.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

const out = ".vercel/output";
rmSync(out, { recursive: true, force: true });
cpSync("dist", `${out}/static`, { recursive: true });

const fn = `${out}/functions/api.func`;
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: ["server/app.ts"],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // Dependências CommonJS (express, exceljs) precisam de require dentro do bundle ESM.
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  minify: true,
  logLevel: "warning",
});
writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 60 }),
);
writeFileSync(
  `${out}/config.json`,
  JSON.stringify({ version: 3, routes: [{ src: "^/api/(.*)$", dest: "/api" }, { handle: "filesystem" }] }),
);
console.log("Saída da Vercel gerada em", out);
