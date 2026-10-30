import { useState } from "react";
import { PageHead } from "../components/ui";
import { goalMonthly, type Snapshot } from "../lib/analytics";
import { addMonths, fmt0, monthLabel } from "../lib/months";
import { uid } from "../lib/seed";
import { useStore } from "../lib/store";
import { parseAmount } from "../lib/parse";

const ICONS = ["🎯", "🛟", "✈️", "🏠", "🚗", "🎓", "💍", "🏖️", "💻"];

export default function Goals({ snap }: { snap: Snapshot }) {
  const { state, update } = useStore();
  const [form, setForm] = useState({ name: "", target: "", saved: "", deadline: addMonths(snap.month, 12), icon: "🎯" });
  const surplus = snap.flow.slice(0, 3).reduce((a, m) => a + m.saldo1, 0) / Math.max(1, Math.min(3, snap.flow.length));
  const needed = state.goals.reduce((a, g) => a + goalMonthly(g, snap.month), 0);

  function add(e: React.FormEvent) {
    e.preventDefault();
    const target = parseAmount(form.target);
    if (!form.name.trim() || !target) return;
    update((s) => ({
      ...s,
      goals: [...s.goals, { id: uid("g"), name: form.name.trim(), target: Math.abs(target), saved: Math.abs(parseAmount(form.saved) ?? 0), deadline: form.deadline, icon: form.icon }],
    }));
    setForm({ ...form, name: "", target: "", saved: "" });
  }

  const contribute = (id: string) => {
    const v = parseAmount(prompt("Valor do aporte (use negativo para retirar):") ?? "");
    if (v) update((s) => ({ ...s, goals: s.goals.map((g) => (g.id === id ? { ...g, saved: Math.max(0, g.saved + v) } : g)) }));
  };

  return (
    <>
      <PageHead title="Metas financeiras" sub="Defina objetivos, prazos e acompanhe quanto precisa guardar por mês." />

      <div className={`notice ${needed > surplus ? "warn" : ""}`} style={{ marginBottom: 16 }}>
        Suas metas pedem <b>{fmt0(needed)}/mês</b>. A sobra média projetada no fluxo de caixa (próximos 3 meses) é <b>{fmt0(surplus)}/mês</b>
        {needed > surplus ? " — considere estender prazos ou priorizar." : " — dá para cumprir todas."}
      </div>

      <div className="grid g3">
        {state.goals.map((g) => {
          const pct = Math.min(100, (g.saved / g.target) * 100);
          const monthly = goalMonthly(g, snap.month);
          return (
            <div className="card" key={g.id}>
              <div className="card-head">
                <h2 style={{ fontSize: 16 }}>
                  {g.icon} {g.name}
                </h2>
                <button
                  className="btn ghost small"
                  title="Excluir"
                  onClick={() => confirm(`Excluir a meta "${g.name}"?`) && update((s) => ({ ...s, goals: s.goals.filter((x) => x.id !== g.id) }))}
                >
                  ✕
                </button>
              </div>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 22, fontWeight: 700 }}>{fmt0(g.saved)}</span>
                <span className="sub">de {fmt0(g.target)}</span>
              </div>
              <div className="progress" style={{ margin: "10px 0" }}>
                <div style={{ width: `${pct}%` }} />
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="sub">
                  {pct >= 100 ? "Meta atingida! 🎉" : `${fmt0(monthly)}/mês até ${monthLabel(g.deadline)}`}
                </span>
                <button className="btn small" onClick={() => contribute(g.id)}>
                  Aportar
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <form className="card" onSubmit={add} style={{ marginTop: 16 }}>
        <h2>Nova meta</h2>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="field">
            Ícone
            <select value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })}>
              {ICONS.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </label>
          <label className="field" style={{ flex: 2, minWidth: 180 }}>
            Nome
            <input type="text" value={form.name} placeholder="ex.: Troca de carro" onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="field">
            Valor alvo
            <input type="text" inputMode="decimal" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} required style={{ width: 120 }} />
          </label>
          <label className="field">
            Já guardado
            <input type="text" inputMode="decimal" value={form.saved} onChange={(e) => setForm({ ...form, saved: e.target.value })} style={{ width: 120 }} />
          </label>
          <label className="field">
            Prazo
            <input type="month" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} required />
          </label>
          <button className="btn primary">Criar meta</button>
        </div>
      </form>
    </>
  );
}
