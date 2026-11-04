import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { mergeManualDuplicates } from "./bills";
import { splitCompany, type LegacyLine } from "./migrate";
import { demoState } from "./seed";
import type { AppState } from "./types";

/** Versão antiga gravava tudo numa chave só, sem usuário. */
const LEGACY_KEY = "caxxa:v1";
/** Cada usuário tem seus dados separados neste navegador. */
export const storageKey = (user: string) => `caxxa:v1:${user}`;
/** Quando os dados deste navegador mudaram pela última vez (para comparar com o servidor). */
const metaKey = (user: string) => `${storageKey(user)}:updatedAt`;

/** Ajusta estados salvos por versões antigas do app. */
function normalize(parsed: AppState | null | undefined): AppState | null {
  if (!parsed || parsed.version !== 1) return null;
  // Estados salvos antes do fluxo da empresa existir: separa as linhas da PJ.
  if (!parsed.company) Object.assign(parsed, splitCompany(parsed.lines as LegacyLine[]));
  // Contas a pagar passaram a vir das despesas do fluxo: contas manuais repetidas viram as automáticas.
  return mergeManualDuplicates(parsed);
}

interface Local {
  state: AppState;
  updatedAt: number;
  /** Havia dados salvos neste navegador (e não apenas os exemplos gerados agora). */
  stored: boolean;
}

function loadLocal(user: string): Local {
  const key = storageKey(user);
  try {
    let raw = localStorage.getItem(key);
    if (!raw && (raw = localStorage.getItem(LEGACY_KEY))) {
      // Dados de antes do login: ficam com o primeiro usuário que entrar neste navegador.
      localStorage.setItem(key, raw);
      localStorage.removeItem(LEGACY_KEY);
    }
    const state = raw ? normalize(JSON.parse(raw) as AppState) : null;
    if (state) return { state, updatedAt: Number(localStorage.getItem(metaKey(user))) || 0, stored: true };
  } catch {
    /* armazenamento indisponível: segue com os dados de exemplo */
  }
  // updatedAt 0 = só exemplos; qualquer dado do servidor tem prioridade.
  return { state: demoState(), updatedAt: 0, stored: false };
}

function saveLocal(user: string, state: AppState, updatedAt: number) {
  try {
    localStorage.setItem(storageKey(user), JSON.stringify(state));
    localStorage.setItem(metaKey(user), String(updatedAt));
  } catch {
    /* ignora: modo privado ou cota cheia */
  }
}

/** local = só neste navegador; saved = igual ao servidor; saving = enviando; offline = falhou, tenta de novo. */
export type SyncStatus = "local" | "loading" | "saved" | "saving" | "offline";

type Updater = (s: AppState) => AppState;
interface Store {
  state: AppState;
  update: (fn: Updater) => void;
  reset: () => void;
  sync: SyncStatus;
  /** Envia ao servidor o que ainda não foi (usar antes de sair da conta). */
  flush: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);
const PUSH_DELAY = 1200;

/**
 * Estado do app. Cada alteração é gravada na hora no navegador e, para usuários logados,
 * enviada ao servidor logo em seguida — assim os dados acompanham o login em qualquer aparelho.
 */
export function StoreProvider({ user, cloud, children }: { user: string; cloud: boolean; children: ReactNode }) {
  const initial = useRef(loadLocal(user));
  const [state, setState] = useState<AppState>(initial.current.state);
  const [sync, setSync] = useState<SyncStatus>(cloud ? "loading" : "local");
  const current = useRef<{ state: AppState; updatedAt: number }>(initial.current);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const adopt = useCallback(
    (next: AppState, updatedAt: number) => {
      current.current = { state: next, updatedAt };
      saveLocal(user, next, updatedAt);
      setState(next);
    },
    [user],
  );

  const push = useCallback(async () => {
    if (!cloud) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { state: s, updatedAt } = current.current;
    pending.current = false;
    setSync("saving");
    try {
      const r = await fetch("/api/data", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ updatedAt, state: s }) });
      if (r.status === 409) {
        // Outro aparelho salvou algo mais novo: fica com a versão do servidor.
        const server = (await r.json()) as { updatedAt: number; state: AppState };
        const next = normalize(server.state);
        if (next) adopt(next, server.updatedAt);
      } else if (!r.ok) throw new Error(String(r.status));
      setSync(pending.current ? "saving" : "saved");
    } catch {
      pending.current = true;
      setSync("offline");
      timer.current = setTimeout(() => void push(), 10_000);
    }
  }, [adopt, cloud]);

  const update = useCallback(
    (fn: Updater) => {
      // Calcula e grava na hora (não espera o React renderizar), para nada se perder se o app fechar.
      const next = fn(current.current.state);
      if (next === current.current.state) return;
      const updatedAt = Math.max(Date.now(), current.current.updatedAt + 1);
      current.current = { state: next, updatedAt };
      saveLocal(user, next, updatedAt);
      setState(next);
      if (!cloud) return;
      pending.current = true;
      setSync("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void push(), PUSH_DELAY);
    },
    [cloud, push, user],
  );

  // Ao entrar: traz do servidor se lá estiver mais novo; senão envia o que há neste navegador.
  useEffect(() => {
    if (!cloud) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/data");
        if (cancelled) return;
        if (r.ok) {
          const server = (await r.json()) as { updatedAt: number; state: AppState };
          const next = normalize(server.state);
          const local = initial.current;
          // Dados gravados neste aparelho antes da sincronização existir: pergunta qual versão manter.
          const legacyConflict = local.stored && local.updatedAt === 0 && JSON.stringify(local.state) !== JSON.stringify(next);
          const keepLocal =
            legacyConflict &&
            confirm(
              "Este aparelho tem dados salvos antes da sincronização, diferentes dos da sua conta.\n\nOK = usar os dados DESTE APARELHO (substituem os da conta)\nCancelar = usar os dados DA CONTA",
            );
          if (next && !keepLocal && server.updatedAt >= current.current.updatedAt) {
            adopt(next, server.updatedAt);
            setSync("saved");
            return;
          }
          if (keepLocal) current.current = { ...current.current, updatedAt: Math.max(Date.now(), server.updatedAt + 1) };
        } else if (r.status !== 404) throw new Error(String(r.status));
        await push();
      } catch {
        if (!cancelled) setSync("offline");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adopt, cloud, push]);

  // App indo para segundo plano / fechando: confirma o campo em edição e envia o que faltar.
  useEffect(() => {
    const flush = () => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (cloud && pending.current) {
        const { state: s, updatedAt } = current.current;
        if (navigator.sendBeacon?.("/api/data", new Blob([JSON.stringify({ updatedAt, state: s })], { type: "text/plain" }))) pending.current = false;
      }
    };
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [cloud]);

  // Se o servidor demorar, libera o app com os dados deste aparelho.
  useEffect(() => {
    if (sync !== "loading") return;
    const t = setTimeout(() => setSync((s) => (s === "loading" ? "offline" : s)), 8000);
    return () => clearTimeout(t);
  }, [sync]);

  const reset = useCallback(() => update(() => demoState()), [update]);
  const flush = useCallback(async () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (cloud && pending.current) await push();
  }, [cloud, push]);

  // Enquanto busca os dados da conta, não mostra os exemplos (evita editar algo que seria substituído).
  if (sync === "loading") return <div className="login-wrap sync-wait">Carregando seus dados…</div>;
  return <Ctx.Provider value={{ state, update, reset, sync, flush }}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore fora do StoreProvider");
  return s;
}
