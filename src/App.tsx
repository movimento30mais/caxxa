import { useEffect, useMemo, useState } from "react";
import { snapshot } from "./lib/analytics";
import { api, type ServerStatus, type Session } from "./lib/api";
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
  { id: "fluxo", label: "Fluxo pessoal", icon: "▦" },
  { id: "empresa", label: "Empresa", icon: "▣" },
  { id: "lancamentos", label: "Lançamentos", icon: "≡" },
  { id: "metas", label: "Metas", icon: "◎" },
  { id: "contas", label: "Contas a pagar", icon: "◷" },
  { id: "openfinance", label: "Open Finance", icon: "⇄" },
  { id: "ia", label: "Assistente IA", icon: "✦" },
] as const;
export type PageId = (typeof PAGES)[number]["id"];

export default function App({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const { state, reset } = useStore();
  const [page, setPage] = useState<PageId>(() => (location.hash.slice(1) as PageId) || "painel");
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const snap = useMemo(() => snapshot(state), [state]);
  useBillNotifications(snap.alerts);
  const pendingBills = snap.alerts.filter((a) => a.status === "atrasada" || a.status === "vence-hoje" || a.status === "proxima").length;

  useEffect(() => {
    api.status().then(setStatus, () => setStatus(null));
  }, []);
  useEffect(() => {
    if (location.hash.slice(1) !== page) history.pushState(null, "", `#${page}`);
    window.scrollTo(0, 0);
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
    PAGES.map((p) => (
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
          {session.authEnabled && (
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <span>👤 {session.user}</span>
              <button className="btn small" onClick={onLogout}>
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
      <nav className="mobile-nav">
        {nav("")}
        {session.authEnabled && (
          <button className="nav-btn" onClick={onLogout}>
            Sair
          </button>
        )}
      </nav>
      <main className="main">
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
