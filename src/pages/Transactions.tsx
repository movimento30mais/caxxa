import { useMemo, useState } from "react";
import { CategoryBars, PageHead, Stat } from "../components/ui";
import { spendingByCategory, type Snapshot } from "../lib/analytics";
import { CATEGORY_NAMES, guessCategory } from "../lib/categories";
import { plannedByCategory } from "../lib/cashflow";
import { fmt, fmt0, monthLabel, monthOf } from "../lib/months";
import { uid } from "../lib/seed";
import { useStore } from "../lib/store";
import { parseAmount } from "../lib/parse";

export default function Transactions({ snap }: { snap: Snapshot }) {
  const { state, update } = useStore();
  const today = new Date().toISOString().slice(0, 10);
  const [month, setMonth] = useState(snap.month);
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ date: today, description: "", amount: "", type: "despesa", category: "", account: "Conta corrente" });

  const months = useMemo(() => [...new Set([snap.month, ...state.transactions.map((t) => monthOf(t.date))])].sort().reverse(), [state.transactions, snap.month]);
  const list = state.transactions
    .filter((t) => monthOf(t.date) === month && (!cat || t.category === cat) && (!q || t.description.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.date.localeCompare(a.date));

  const actual = spendingByCategory(state.transactions, month);
  const planned = plannedByCategory(state.lines, month);
  const budget = [...new Set([...Object.keys(actual), ...Object.keys(planned)])]
    .map((name) => ({ name, realizado: Math.round(actual[name] ?? 0), orcamento: Math.round(planned[name] ?? 0) }))
    .sort((a, b) => b.realizado - a.realizado);
  const entradas = state.transactions.filter((t) => monthOf(t.date) === month && t.amount > 0).reduce((a, t) => a + t.amount, 0);
  const saidas = Object.values(actual).reduce((a, b) => a + b, 0);

  function add(e: React.FormEvent) {
    e.preventDefault();
    const v = parseAmount(form.amount);
    if (!v || !form.description.trim()) return;
    const amount = form.type === "despesa" ? -Math.abs(v) : Math.abs(v);
    const category = form.category || guessCategory(form.description, amount);
    update((s) => ({
      ...s,
      transactions: [{ id: uid("t"), date: form.date, description: form.description.trim(), amount, category, account: form.account, source: "manual" }, ...s.transactions],
    }));
    setForm((f) => ({ ...f, description: "", amount: "", category: "" }));
    setMonth(monthOf(form.date));
  }

  const suggested = form.description ? guessCategory(form.description, form.type === "despesa" ? -1 : 1) : "";

  return (
    <>
      <PageHead title="Lançamentos" sub="Registre receitas e despesas; a categoria é sugerida automaticamente.">
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mês">
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </PageHead>

      <form className="card" onSubmit={add} style={{ marginBottom: 16 }}>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="tabs" role="radiogroup" aria-label="Tipo">
            {["despesa", "receita"].map((t) => (
              <button type="button" key={t} className={form.type === t ? "on" : ""} onClick={() => setForm({ ...form, type: t })}>
                {t === "despesa" ? "Despesa" : "Receita"}
              </button>
            ))}
          </div>
          <label className="field">
            Data
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </label>
          <label className="field" style={{ flex: 2, minWidth: 180 }}>
            Descrição
            <input type="text" value={form.description} placeholder="ex.: Supermercado" onChange={(e) => setForm({ ...form, description: e.target.value })} required />
          </label>
          <label className="field" style={{ width: 120 }}>
            Valor (R$)
            <input type="text" inputMode="decimal" value={form.amount} placeholder="0,00" onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </label>
          <label className="field">
            Categoria
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">{suggested ? `Auto: ${suggested}` : "Automática"}</option>
              {CATEGORY_NAMES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Conta
            <input type="text" value={form.account} style={{ width: 140 }} onChange={(e) => setForm({ ...form, account: e.target.value })} />
          </label>
          <button className="btn primary" type="submit">
            Adicionar
          </button>
        </div>
      </form>

      <div className="grid g3">
        <Stat label={`Entradas em ${monthLabel(month)}`} value={fmt0(entradas)} tone="pos" />
        <Stat label={`Saídas em ${monthLabel(month)}`} value={fmt0(saidas)} tone="neg" />
        <Stat label="Resultado" value={fmt0(entradas - saidas)} tone={entradas - saidas < 0 ? "neg" : "pos"} />
      </div>

      <div className="grid g3" style={{ marginTop: 16 }}>
        <div className="card span2">
          <div className="card-head">
            <h2>{list.length} lançamentos</h2>
            <div className="row">
              <input type="text" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 140 }} />
              <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filtrar categoria">
                <option value="">Todas as categorias</option>
                {CATEGORY_NAMES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="list">
            {list.map((t) => (
              <div className="list-item" key={t.id}>
                <span className="sub" style={{ width: 44 }}>
                  {t.date.slice(8, 10)}/{t.date.slice(5, 7)}
                </span>
                <div className="grow">
                  <div className="ellipsis">{t.description}</div>
                  <div className="sub">
                    {t.account}
                    {t.source === "openfinance" && " · Open Finance"}
                  </div>
                </div>
                <select
                  value={t.category}
                  aria-label="Categoria"
                  onChange={(e) => update((s) => ({ ...s, transactions: s.transactions.map((x) => (x.id === t.id ? { ...x, category: e.target.value } : x)) }))}
                >
                  {CATEGORY_NAMES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <span className={t.amount < 0 ? "neg" : "pos"} style={{ width: 110, textAlign: "right" }}>
                  {fmt(t.amount)}
                </span>
                <button className="btn ghost small" title="Excluir" onClick={() => update((s) => ({ ...s, transactions: s.transactions.filter((x) => x.id !== t.id) }))}>
                  ✕
                </button>
              </div>
            ))}
            {!list.length && <div className="empty">Nenhum lançamento neste mês.</div>}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Orçamento do mês</h2>
            <span className="sub">orçamento = coluna Base</span>
          </div>
          <CategoryBars
            data={budget}
            series={[
              { key: "realizado", label: "Realizado", color: "var(--series-1)" },
              { key: "orcamento", label: "Orçamento", color: "var(--series-2)" },
            ]}
          />
        </div>
      </div>
    </>
  );
}
