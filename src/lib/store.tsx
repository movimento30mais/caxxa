import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { splitCompany, type LegacyLine } from "./migrate";
import { demoState } from "./seed";
import type { AppState } from "./types";

/** Versão antiga gravava tudo numa chave só, sem usuário. */
const LEGACY_KEY = "caxxa:v1";
/** Cada usuário tem seus dados separados neste navegador. */
export const storageKey = (user: string) => `caxxa:v1:${user}`;

function load(key: string): AppState {
  try {
    let raw = localStorage.getItem(key);
    if (!raw && (raw = localStorage.getItem(LEGACY_KEY))) {
      // Dados de antes do login: ficam com o primeiro usuário que entrar neste navegador.
      localStorage.setItem(key, raw);
      localStorage.removeItem(LEGACY_KEY);
    }
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed.version === 1) {
        // Estados salvos antes do fluxo da empresa existir: separa as linhas da PJ.
        if (!parsed.company) Object.assign(parsed, splitCompany(parsed.lines as LegacyLine[]));
        return parsed;
      }
    }
  } catch {
    /* armazenamento indisponível: segue com os dados de exemplo */
  }
  return demoState();
}

type Updater = (s: AppState) => AppState;
interface Store {
  state: AppState;
  update: (fn: Updater) => void;
  reset: () => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ user, children }: { user: string; children: ReactNode }) {
  const key = storageKey(user);
  const [state, setState] = useState<AppState>(() => load(key));
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* ignora: modo privado ou cota cheia */
    }
  }, [key, state]);
  return <Ctx.Provider value={{ state, update: setState, reset: () => setState(demoState()) }}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore fora do StoreProvider");
  return s;
}
