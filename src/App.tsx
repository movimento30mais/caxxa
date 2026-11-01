import { useEffect, useMemo, useState } from "react";
import { snapshot } from "./lib/analytics";
import { api, type ServerStatus, type Session } from "./lib/api";
import { Onboarding } from "./components/Onboarding";
import { companyEnabled } from "./lib/company";
import { useStore } from "./lib/store";
import Dashboard from "./pages/Dashboard";
import Cashflow from "./pages/Cashflow";
import Company from "./pages/Company";
import Transactions from "./pages/Transactions";
import Goals from "./pages/Goals";
import Bills, { useBillNotifications } from "./pages/Bills";
import OpenFinance from "./pages/OpenFinance";
import Assistant from "./pages/Assistant";

const PAGES = [
  { id: "painel", label: "Painel", icon: "◧" },
  { id: "fluxo", label: "Fluxo pessoal", icon: "▦", short: "Fluxo" },
  { id: "empresa", label: "Empresa", icon: "▣" },
  { id: "lancamentos", label: "Lançamentos", icon: "≡", short: "Lançar" },
  { id: "metas", label: "Metas", icon: "◎" },
  { id: "contas", label: "Contas a pagar", icon: "◷" },
  { id: "openfinance", label: "Open Finance", icon: "⇄" },
  { id: "ia", label: "Assistente IA", icon: "✦" },
] as const;
export type PageId = (typeof PAGES)[number]["id"];

const SYNC_LABEL: Record<ReturnType<typeof useStore>["sync"], { text: string; tone: string }> = {
  saved: { text: "✓ Salvo na sua conta", tone: "ok" },
  saving: { text: "Salvando…", tone: "busy" },
  offline: { text: "Sem conexão: salvo neste aparelho, envio quando voltar", tone: "warn" },
  loading: { text: "Carregando…", tone: "busy" },
  local: { text: "Salvo só neste navegador", tone: "busy" },
};

/** Abas fixas na barra inferior do celular; as demais ficam em "Mais". */
const MOBILE_TABS: PageId[] = ["painel", "fluxo", "lancamentos", "metas"];

export default function App({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const { state, reset, sync, flush } = useStore();
  const logout = () => void flush().finally(onLogout);
  const syncLabel = SYNC_LABEL[sync];
  const [page, setPage] = useState<PageId>(() => (location.hash.slice(1) as PageId) || "painel");
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [more, setMore] = useState(false);
  const snap = useMemo(() => snapshot(state), [state]);
  useBillNotifications(snap.alerts);
  const pendingBills = snap.alerts.filter((a) => a.status === "atrasada" || a.status === "vence-hoje" || a.status === "proxima").length;

  useEffect(() => {
    api.status().then(setStatus, () => setStatus(null));
  }, []);
  useEffect(() => {
    if (location.hash.slice(1) !== page) history.pushState(null, "", `#${page}`);
    window.scrollTo(0, 0);
    setMore(false);
  }, [page]);
  useEffect(() => {
    const onHash = () => setPage((location.hash.slice(1) as PageId) || "painel");
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, []);

  const nav = (cls: string) =>
    // O menu Empresa só aparece para quem recebe pela empresa (PJ).
    PAGES.filter((p) => p.id !== "empresa" || companyEnabled(state.company)).map((p) => (
      <button key={p.id} className={`nav-btn ${page === p.id ? "active" : ""} ${cls}`} onClick={() => setPage(p.id)}>
        <span aria-hidden>{p.icon}</span>
        {p.label}
        {p.id === "contas" && pendingBills > 0 && <span className="nav-badge">{pendingBills}</span>}
      </button>
    ));

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          caxxa<span>.</span>
        </div>
        {nav("")}
        <div className="sidebar-foot">
          <div className={`sync ${syncLabel.tone}`} style={{ marginBottom: 8 }}>
            {syncLabel.text}
          </div>
          {session.authEnabled && (
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <span>👤 {session.user}</span>
              <button className="btn small" onClick={logout}>
                Sair
              </button>
            </div>
          )}
          <button
            className="btn ghost small"
            style={{ padding: 0, marginBottom: 8, color: "var(--muted)" }}
            onClick={() => confirm("Apagar seus dados neste navegador e voltar aos dados de exemplo?") && reset()}
          >
            ↺ Voltar aos dados de exemplo
          </button>
          <br />
          IA: {status?.ai ? "Claude conectado" : "análise local"}
          <br />
          Open Finance: {status?.openFinance === "pluggy" ? "Pluggy" : "sandbox"}
        </div>
      </aside>
      {/* Celular: barra superior enxuta + barra de abas embaixo; o restante fica em "Mais". */}
      <header className="m-topbar">
        <div className="brand">
          caxxa<span>.</span>
        </div>
        <span className="m-title">{PAGES.find((p) => p.id === page)?.label}</span>
        <span className={`sync m-sync ${syncLabel.tone}`} title={syncLabel.text}>
          {sync === "saved" ? "✓ Salvo" : sync === "offline" ? "⚠ Offline" : sync === "local" ? "" : "Salvando…"}
        </span>
      </header>
      <nav className="m-tabbar" aria-label="Navegação">
        {MOBILE_TABS.map((id) => {
          const p = PAGES.find((x) => x.id === id)!;
          return (
            <button key={id} className={page === id && !more ? "on" : ""} onClick={() => setPage(id)}>
              <span className="m-tab-icon" aria-hidden>
                {p.icon}
              </span>
              {"short" in p ? p.short : p.label}
            </button>
          );
        })}
        <button className={more || !MOBILE_TABS.includes(page) ? "on" : ""} onClick={() => setMore((v) => !v)} aria-expanded={more}>
          <span className="m-tab-icon" aria-hidden>
            ☰
          </span>
          Mais
          {pendingBills > 0 && <span className="nav-badge">{pendingBills}</span>}
        </button>
      </nav>
      {more && (
        <div className="m-sheet-backdrop" onClick={() => setMore(false)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Mais opções">
            <div className="m-sheet-handle" />
            {nav("")}
            <div className="m-sheet-foot">
              {session.authEnabled && <span>👤 {session.user}</span>}
              <button className="btn small" onClick={() => confirm("Apagar seus dados neste navegador e voltar aos dados de exemplo?") && reset()}>
                ↺ Dados de exemplo
              </button>
              {session.authEnabled && (
                <button className="btn small" onClick={logout}>
                  Sair
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <main className="main">
        <Onboarding onPj={() => setPage("empresa")} />
        {page === "painel" && <Dashboard snap={snap} go={setPage} />}
        {page === "fluxo" && <Cashflow snap={snap} />}
        {page === "empresa" && <Company snap={snap} />}
        {page === "lancamentos" && <Transactions snap={snap} />}
        {page === "metas" && <Goals snap={snap} />}
        {page === "contas" && <Bills snap={snap} />}
        {page === "openfinance" && <OpenFinance status={status} />}
        {page === "ia" && <Assistant snap={snap} status={status} />}
      </main>
    </div>
  );
}
