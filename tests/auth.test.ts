import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const entry = execFileSync("node", ["scripts/hash-password.mjs", "Ana", "s3nha-forte"]).toString().trim();
let base = "";
let close: () => void;

beforeAll(async () => {
  process.env.AUTH_USERS = entry;
  process.env.AUTH_SECRET = "segredo-de-teste";
  process.env.AUTH_SIGNUP = "memory";
  const { default: app } = await import("../server/app");
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => close?.());

const post = (path: string, username: string, password: string) =>
  fetch(`${base}/api/auth/${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" }, body: JSON.stringify({ username, password }) });
const login = (username: string, password: string) => post("login", username, password);
const signup = (username: string, password: string) => post("signup", username, password);

describe("login", () => {
  it("gera a entrada de AUTH_USERS com hash scrypt", () => {
    expect(entry).toMatch(/^ana:scrypt\$[\w-]+\$[\w-]+$/);
    expect(entry).not.toContain("s3nha-forte");
  });

  it("bloqueia a API sem sessão", async () => {
    expect((await fetch(`${base}/api/status`)).status).toBe(401);
    expect((await fetch(`${base}/api/auth/me`)).status).toBe(401);
  });

  it("recusa senha errada", async () => {
    const r = await login("ana", "errada");
    expect(r.status).toBe(401);
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("aceita usuário e senha corretos e libera a API com o cookie", async () => {
    const r = await login("ANA", "s3nha-forte");
    expect(r.status).toBe(200);
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toMatch(/caxxa_session=.+; Path=\/; HttpOnly; SameSite=Lax/);
    const session = cookie.split(";")[0];
    expect(await (await fetch(`${base}/api/auth/me`, { headers: { cookie: session } })).json()).toEqual({ user: "ana", authEnabled: true, signupEnabled: true });
    expect((await fetch(`${base}/api/status`, { headers: { cookie: session } })).status).toBe(200);
  });

  it("recusa cookie adulterado", async () => {
    const session = (await login("ana", "s3nha-forte")).headers.get("set-cookie")!.split(";")[0];
    const [payload, mac] = session.split("=")[1].split(".");
    const forged = Buffer.from(JSON.stringify({ u: "ana", exp: Date.now() * 2 })).toString("base64url");
    expect((await fetch(`${base}/api/status`, { headers: { cookie: `caxxa_session=${forged}.${mac}` } })).status).toBe(401);
    expect(payload).not.toBe(forged);
  });
});

describe("cadastro aberto", () => {
  it("cria a conta, já entra logado e depois faz login com a mesma senha", async () => {
    const r = await signup("Bia.Silva", "minha-senha-1");
    expect(r.status).toBe(201);
    const session = r.headers.get("set-cookie")!.split(";")[0];
    expect(await (await fetch(`${base}/api/auth/me`, { headers: { cookie: session } })).json()).toEqual({ user: "bia.silva", authEnabled: true, signupEnabled: true });
    expect((await login("bia.silva", "minha-senha-1")).status).toBe(200);
    expect((await login("bia.silva", "outra-senha")).status).toBe(401);
  });

  it("recusa usuário repetido, inclusive o das contas fixas", async () => {
    expect((await signup("bia.silva", "qualquer-senha")).status).toBe(409);
    expect((await signup("ana", "qualquer-senha")).status).toBe(409);
    // A conta fixa continua com a senha original.
    expect((await login("ana", "s3nha-forte")).status).toBe(200);
  });

  it("valida usuário e senha", async () => {
    expect((await signup("a", "senha-longa-ok")).status).toBe(400);
    expect((await signup("com espaço", "senha-longa-ok")).status).toBe(400);
    expect((await signup("local", "senha-longa-ok")).status).toBe(400);
    expect((await signup("carlos", "curta")).status).toBe(400);
  });

  it("informa à tela de login que o cadastro está aberto", async () => {
    const r = await fetch(`${base}/api/auth/me`);
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ signupEnabled: true });
  });
});

describe("tela de login após sair", () => {
  it("login e cadastro informam se o cadastro está aberto, para a aba continuar visível", async () => {
    expect(await (await login("ana", "s3nha-forte")).json()).toMatchObject({ signupEnabled: true });
    expect(await (await signup("davi", "senha-do-davi")).json()).toMatchObject({ signupEnabled: true });
  });
});
