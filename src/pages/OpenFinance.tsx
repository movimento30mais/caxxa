import { useState } from "react";
import { PageHead } from "../components/ui";
import { api, type ServerStatus } from "../lib/api";
import { guessCategory } from "../lib/categories";
import { uid } from "../lib/seed";
import { useStore } from "../lib/store";
import type { BankConnection, Transaction } from "../lib/types";

const INSTITUTIONS = ["Itaú", "Bradesco", "Banco do Brasil", "Nubank", "Santander", "Caixa", "Inter", "C6 Bank", "XP", "BTG Pactual"];

// Categorias do Pluggy (em inglês) mais comuns → categorias do app.
const PLUGGY_CATEGORIES: Record<string, string> = {
  Groceries: "Alimentação",
  "Eating out": "Alimentação",
  "Food delivery": "Alimentação",
  "Gas stations": "Transporte",
  Transportation: "Transporte",
  "Taxi and ride-hailing": "Transporte",
  Parking: "Transporte",
  Pharmacy: "Saúde",
  Healthcare: "Saúde",
  Insurance: "Seguros",
  Housing: "Moradia",
  Utilities: "Moradia",
  Electricity: "Moradia",
  Rent: "Moradia",
  "Telecommunications": "Serviços",
  "Video streaming": "Serviços",
  "Music streaming": "Serviços",
  Taxes: "Impostos",
  Leisure: "Lazer",
  Travel: "Lazer",
  Salary: "Renda",
  "Credit card payment": "Cartões",
};

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

export default function OpenFinance({ status }: { status: ServerStatus | null }) {
  const { state, update } = useStore();
  const mode = status?.openFinance ?? "sandbox";
  const [institution, setInstitution] = useState(INSTITUTIONS[0]);
  const [itemId, setItemId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function sync(conn: BankConnection) {
    setBusy(conn.id);
    setMsg(null);
    try {
      const from = conn.lastSync ? daysAgo(Math.max(3, Math.ceil((Date.now() - Date.parse(conn.lastSync)) / 86400000) + 3)) : daysAgo(90);
      const r = await api.sync(conn.itemId, conn.institution, from);
      const known = new Set(state.transactions.map((t) => t.externalId).filter(Boolean));
      const fresh: Transaction[] = r.transactions
        .filter((t) => !known.has(t.externalId))
        .map((t) => ({
          id: uid("t"),
          externalId: t.externalId,
          date: t.date,
          description: t.description,
          amount: t.amount,
          category: (t.category && PLUGGY_CATEGORIES[t.category]) || guessCategory(t.description, t.amount),
          account: t.account,
          source: "openfinance",
        }));
      update((s) => {
        const seen = new Set(s.transactions.map((t) => t.externalId).filter(Boolean));
        return {
          ...s,
          transactions: [...fresh.filter((t) => !seen.has(t.externalId)), ...s.transactions].sort((a, b) => b.date.localeCompare(a.date)),
          connections: s.connections.map((c) => (c.id === conn.id ? { ...c, institution: r.institution, lastSync: new Date().toISOString() } : c)),
        };
      });
      setMsg({ kind: "ok", text: `${r.institution}: ${r.transactions.length} transações lidas, ${fresh.length} novas importadas e categorizadas.` });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  function connect(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "pluggy" && !itemId.trim()) return;
    const conn: BankConnection = { id: uid("c"), institution, itemId: itemId.trim() || uid("sandbox"), mode };
    update((s) => ({ ...s, connections: [...s.connections, conn] }));
    setItemId("");
    void sync(conn);
  }

  return (
    <>
      <PageHead title="Open Finance" sub="Conecte contas e cartões para importar e categorizar transações automaticamente." />

      <div className={`notice ${mode === "sandbox" ? "warn" : ""}`} style={{ marginBottom: 16 }}>
        {mode === "sandbox" ? (
          <>
            <b>Modo sandbox:</b> as conexões geram transações simuladas. Para dados reais, configure <code>PLUGGY_CLIENT_ID</code> e <code>PLUGGY_CLIENT_SECRET</code> no
            servidor (agregador Open Finance autorizado pelo Banco Central). Veja o README.
          </>
        ) : (
          <>
            <b>Pluggy conectado.</b> Autorize o acesso à sua conta pelo Pluggy Connect e cole aqui o <i>Item ID</i> gerado. O consentimento Open Finance
            é dado diretamente ao seu banco e pode ser revogado a qualquer momento.
          </>
        )}
      </div>

      {msg && (
        <div className={`notice ${msg.kind === "err" ? "err" : ""}`} style={{ marginBottom: 16 }}>
          {msg.text}
        </div>
      )}

      <div className="grid g2">
        <form className="card" onSubmit={connect}>
          <h2>Nova conexão</h2>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="field">
              Instituição
              <select value={institution} onChange={(e) => setInstitution(e.target.value)}>
                {INSTITUTIONS.map((i) => (
                  <option key={i}>{i}</option>
                ))}
              </select>
            </label>
            {mode === "pluggy" && (
              <label className="field" style={{ flex: 1, minWidth: 200 }}>
                Item ID (Pluggy)
                <input type="text" value={itemId} onChange={(e) => setItemId(e.target.value)} placeholder="ex.: 7b2c…" required />
              </label>
            )}
            <button className="btn primary" disabled={busy !== null}>
              Conectar
            </button>
          </div>
        </form>

        <div className="card">
          <h2>Conexões</h2>
          <div className="list">
            {state.connections.map((c) => (
              <div className="list-item" key={c.id}>
                <div className="grow">
                  <div>
                    {c.institution} {c.mode === "sandbox" && <span className="chip neutral">sandbox</span>}
                  </div>
                  <div className="sub">{c.lastSync ? `Sincronizado em ${new Date(c.lastSync).toLocaleString("pt-BR")}` : "Nunca sincronizado"}</div>
                </div>
                <button className="btn small" disabled={busy !== null} onClick={() => sync(c)}>
                  {busy === c.id ? "Sincronizando…" : "Sincronizar"}
                </button>
                <button
                  className="btn ghost small"
                  title="Remover conexão"
                  onClick={() => confirm(`Remover a conexão com ${c.institution}? As transações já importadas são mantidas.`) && update((s) => ({ ...s, connections: s.connections.filter((x) => x.id !== c.id) }))}
                >
                  ✕
                </button>
              </div>
            ))}
            {!state.connections.length && <div className="empty">Nenhuma conta conectada.</div>}
          </div>
        </div>
      </div>
    </>
  );
}
