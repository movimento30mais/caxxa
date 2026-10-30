import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Login por usuário e senha.
 * - AUTH_USERS: lista "usuario:scrypt$salt$hash" separada por vírgulas (gere com `npm run hash-password`).
 * - AUTH_SECRET: chave para assinar o cookie de sessão.
 * Sem AUTH_USERS o login fica desligado (uso local).
 */
const COOKIE = "caxxa_session";
const MAX_AGE_S = 30 * 24 * 3600;

function users(): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of (process.env.AUTH_USERS ?? "").split(",")) {
    const i = entry.indexOf(":");
    if (i > 0) out.set(entry.slice(0, i).trim().toLowerCase(), entry.slice(i + 1).trim());
  }
  return out;
}

export function authEnabled(): boolean {
  return users().size > 0;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

// Sem AUTH_SECRET as sessões valem só enquanto este processo viver.
const fallbackSecret = randomBytes(32).toString("hex");
const sign = (payload: string) => createHmac("sha256", process.env.AUTH_SECRET || fallbackSecret).update(payload).digest("base64url");

function issueToken(user: string): string {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + MAX_AGE_S * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readToken(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = sign(payload);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: string; exp: number };
    return exp > Date.now() && users().has(u) ? u : null;
  } catch {
    return null;
  }
}

function cookieOf(req: Request): string | undefined {
  const m = /(?:^|;\s*)caxxa_session=([^;]+)/.exec(req.headers.cookie ?? "");
  return m?.[1];
}

function setCookie(res: Response, value: string, maxAge: number) {
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

export function currentUser(req: Request): string | null {
  return authEnabled() ? readToken(cookieOf(req)) : "local";
}

export async function login(req: Request, res: Response) {
  const username = String(req.body?.username ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  const stored = users().get(username);
  if (!stored || !verifyPassword(password, stored)) {
    // Atraso fixo para dificultar tentativas em sequência.
    await new Promise((r) => setTimeout(r, 600));
    res.status(401).json({ error: "Usuário ou senha incorretos." });
    return;
  }
  setCookie(res, issueToken(username), MAX_AGE_S);
  res.json({ user: username, authEnabled: true });
}

export function logout(_req: Request, res: Response) {
  setCookie(res, "", 0);
  res.json({ ok: true });
}

export function me(req: Request, res: Response) {
  const user = currentUser(req);
  if (!user) res.status(401).json({ error: "Faça login.", authEnabled: true });
  else res.json({ user, authEnabled: authEnabled() });
}

/** Bloqueia as rotas da API para quem não está logado. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (currentUser(req)) next();
  else res.status(401).json({ error: "Faça login." });
}
