import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { demoState } from "./seed";
import type { AppState } from "./types";

const KEY = "caxxa:v1";

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed.version === 1) return parsed;
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

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignora: modo privado ou cota cheia */
    }
  }, [state]);
  return <Ctx.Provider value={{ state, update: setState, reset: () => setState(demoState()) }}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore fora do StoreProvider");
  return s;
}
