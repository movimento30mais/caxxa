import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { dataStore } from "./dataStore";
import { userStore } from "./userStore";

/**
 * Login por usuário e senha.
 * - AUTH_USERS: contas fixas "usuario:scrypt$salt$hash" separadas por vírgulas (gere com `npm run hash-password`).
 * - Cadastro aberto: contas criadas na tela "Criar conta", guardadas no Vercel Blob privado (userStore).
 * - AUTH_SECRET: chave para assinar o cookie de sessão.
 * Sem AUTH_USERS e sem armazenamento de contas, o login fica desligado (uso local).
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
  return users().size > 0 || userStore() !== null;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString("base64url")}`;
}

async function storedHash(username: string): Promise<string | null> {
  return users().get(username) ?? (await userStore()?.getHash(username)) ?? null;
}

/** Limite simples por IP (por instância do servidor): tentativas dentro de uma janela de tempo. */
const hits = new Map<string, number[]>();
function tooMany(req: Request, kind: string, max: number, windowMs: number): boolean {
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
  const key = `${kind}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
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
    return exp > Date.now() ? u : null;
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
  if (tooMany(req, "login", 20, 15 * 60_000)) {
    res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos." });
    return;
  }
  const stored = username ? await storedHash(username) : null;
  if (!stored || !verifyPassword(password, stored)) {
    // Atraso fixo para dificultar tentativas em sequência.
    await new Promise((r) => setTimeout(r, 600));
    res.status(401).json({ error: "Usuário ou senha incorretos." });
    return;
  }
  setCookie(res, issueToken(username), MAX_AGE_S);
  res.json({ user: username, authEnabled: true, signupEnabled: userStore() !== null, cloudSync: dataStore() !== null });
}

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,29}$/;

/** Cadastro aberto: qualquer pessoa cria uma conta e já entra logada. */
export async function signup(req: Request, res: Response) {
  const store = userStore();
  if (!store) {
    res.status(404).json({ error: "Cadastro desativado neste servidor." });
    return;
  }
  const username = String(req.body?.username ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  if (!USERNAME.test(username) || username === "local") {
    res.status(400).json({ error: "Usuário deve ter de 3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado." });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "A senha precisa ter pelo menos 8 caracteres." });
    return;
  }
  if (tooMany(req, "signup", 5, 60 * 60_000)) {
    res.status(429).json({ error: "Muitos cadastros a partir desta conexão. Tente mais tarde." });
    return;
  }
  if (users().has(username) || !(await store.create(username, hashPassword(password)))) {
    res.status(409).json({ error: "Esse usuário já existe. Escolha outro." });
    return;
  }
  setCookie(res, issueToken(username), MAX_AGE_S);
  res.status(201).json({ user: username, authEnabled: true, signupEnabled: true, cloudSync: dataStore() !== null });
}

export function logout(_req: Request, res: Response) {
  setCookie(res, "", 0);
  res.json({ ok: true });
}

export function me(req: Request, res: Response) {
  const user = currentUser(req);
  const signupEnabled = userStore() !== null;
  if (!user) res.status(401).json({ error: "Faça login.", authEnabled: true, signupEnabled });
  else res.json({ user, authEnabled: authEnabled(), signupEnabled, cloudSync: user !== "local" && dataStore() !== null });
}

/** Bloqueia as rotas da API para quem não está logado. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (currentUser(req)) next();
  else res.status(401).json({ error: "Faça login." });
}
