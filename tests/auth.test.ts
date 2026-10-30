import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const entry = execFileSync("node", ["scripts/hash-password.mjs", "Ana", "s3nha-forte"]).toString().trim();
let base = "";
let close: () => void;

beforeAll(async () => {
  process.env.AUTH_USERS = entry;
  process.env.AUTH_SECRET = "segredo-de-teste";
  const { default: app } = await import("../server/app");
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => close?.());

const login = (username: string, password: string) =>
  fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });

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
    expect(await (await fetch(`${base}/api/auth/me`, { headers: { cookie: session } })).json()).toEqual({ user: "ana", authEnabled: true });
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
