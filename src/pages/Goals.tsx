import { useState } from "react";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHead } from "../components/ui";
import { goalsProgress, type Snapshot } from "../lib/analytics";
import type { GoalProgress } from "../lib/goals";
import { addMonths, fmt, fmt0, fmtK, monthLabel } from "../lib/months";
import { parseAmount } from "../lib/parse";
import { uid } from "../lib/seed";
import { useStore } from "../lib/store";
import type { Goal } from "../lib/types";

const ICONS = ["🎯", "💰", "🛟", "✈️", "🏠", "🚗", "🎓", "💍", "🏖️", "💻"];
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

/** Gráfico pequeno: patrimônio projetado até o prazo e a linha do valor alvo. */
function PatrimonyChart({ p, goal }: { p: NonNullable<GoalProgress["auto"]>; goal: Goal }) {
  const data = p.series.map((s) => ({ mes: monthLabel(s.month), Patrimônio: Math.round(s.value) }));
  return (
    <ResponsiveContainer width="100%" height={120}>
      <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <XAxis dataKey="mes" axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tickFormatter={fmtK} axisLine={false} tickLine={false} width={64} />
        <Tooltip formatter={(v) => fmt(Number(v))} />
        <ReferenceLine y={goal.target} ifOverflow="extendDomain" stroke="var(--series-2)" strokeDasharray="4 3" label={{ value: "meta", position: "insideTopLeft", fill: "var(--muted)", fontSize: 11 }} />
        <Area type="monotone" dataKey="Patrimônio" stroke="var(--series-1)" fill="var(--series-1)" fillOpacity={0.15} strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export default function Goals({ snap }: { snap: Snapshot }) {
  const { state, update } = useStore();
  const hasPrev = state.investments.some((i) => i.kind === "previdencia");
  const [form, setForm] = useState({ kind: "manual" as "manual" | "patrimonio", name: "", target: "", saved: "", deadline: addMonths(snap.month, 12), icon: "🎯", includePrevidencia: true });
  const progress = goalsProgress(state, snap);
  const surplus = snap.flow.slice(0, 3).reduce((a, m) => a + m.saldo1, 0) / Math.max(1, Math.min(3, snap.flow.length));
  const needed = progress.reduce((a, p) => a + p.monthly, 0);

  function add(e: React.FormEvent) {
    e.preventDefault();
    const target = parseAmount(form.target);
    if (!form.name.trim() || !target) return;
    const goal: Goal =
      form.kind === "patrimonio"
        ? { id: uid("g"), kind: "patrimonio", name: form.name.trim(), target: Math.abs(target), saved: 0, deadline: form.deadline, icon: form.icon, includePrevidencia: form.includePrevidencia }
        : { id: uid("g"), name: form.name.trim(), target: Math.abs(target), saved: Math.abs(parseAmount(form.saved) ?? 0), deadline: form.deadline, icon: form.icon };
    update((s) => ({ ...s, goals: [...s.goals, goal] }));
    setForm({ ...form, name: "", target: "", saved: "" });
  }

  const contribute = (id: string) => {
    const v = parseAmount(prompt("Valor do aporte (use negativo para retirar):") ?? "");
    if (v) update((s) => ({ ...s, goals: s.goals.map((g) => (g.id === id ? { ...g, saved: Math.max(0, g.saved + v) } : g)) }));
  };

  const setKind = (kind: "manual" | "patrimonio") =>
    setForm((f) => ({ ...f, kind, icon: kind === "patrimonio" ? "💰" : f.icon === "💰" ? "🎯" : f.icon, name: kind === "patrimonio" && !f.name ? "Patrimônio" : f.name }));

  return (
    <>
      <PageHead title="Metas financeiras" sub="Defina objetivos, prazos e acompanhe quanto precisa guardar por mês." />

      <div className={`notice ${needed > surplus ? "warn" : ""}`} style={{ marginBottom: 16 }}>
        Suas metas pedem <b>{fmt0(needed)}/mês</b>. A sobra média projetada no fluxo de caixa (próximos 3 meses) é <b>{fmt0(surplus)}/mês</b>
        {needed > surplus ? " — considere estender prazos ou priorizar." : " — dá para cumprir todas."}
      </div>

      <div className="grid g3">
        {progress.map(({ goal: g, saved, monthly, auto }) => {
          const done = Math.min(100, (saved / g.target) * 100);
          return (
            <div className="card goal-card" key={g.id}>
              <div className="card-head">
                <h2 style={{ fontSize: 16 }}>
                  {g.icon} {g.name}
                </h2>
                <span className="row" style={{ gap: 4 }}>
                  {auto && <span className="chip neutral">do fluxo</span>}
                  <button
                    className="btn ghost small"
                    title="Excluir"
                    aria-label={`Excluir a meta ${g.name}`}
                    onClick={() => confirm(`Excluir a meta "${g.name}"?`) && update((s) => ({ ...s, goals: s.goals.filter((x) => x.id !== g.id) }))}
                  >
                    ✕
                  </button>
                </span>
              </div>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 22, fontWeight: 700 }}>{fmt0(saved)}</span>
                <span className="sub">de {fmt0(g.target)}</span>
              </div>
              <div className="progress" style={{ margin: "10px 0" }}>
                <div style={{ width: `${done}%` }} />
              </div>

              {auto ? (
                <>
                  <p className={`goal-reach ${auto.reachMonth && auto.reachMonth <= g.deadline ? "pos" : "warn-text"}`}>
                    {done >= 100
                      ? "Meta atingida! 🎉"
                      : auto.reachMonth
                        ? `Pela projeção, atinge a meta em ${monthLabel(auto.reachMonth)}${auto.reachMonth <= g.deadline ? " — dentro do prazo" : ` — depois do prazo (${monthLabel(g.deadline)})`}`
                        : "Pela projeção atual, não atinge a meta"}
                  </p>
                  <PatrimonyChart p={auto} goal={g} />
                  <div className="goal-facts">
                    <span>
                      Projeção em {monthLabel(g.deadline)}: <b>{fmt0(auto.atDeadline)}</b>
                      {auto.atDeadline < g.target && <> (faltam {fmt0(g.target - auto.atDeadline)})</>}
                    </span>
                    <span>
                      Aporte necessário: <b>{fmt0(monthly)}/mês</b> · o fluxo aplica em média {fmt0(auto.contribution)}/mês
                    </span>
                    <span>
                      Rendimento médio {pct(auto.rate)} a.m. · {g.includePrevidencia === false || !hasPrev ? "investimentos" : "investimentos + previdência"} (sem saldo em conta)
                    </span>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
                    {hasPrev ? (
                      <label className="row sub" style={{ gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={g.includePrevidencia !== false}
                          onChange={(e) => update((s) => ({ ...s, goals: s.goals.map((x) => (x.id === g.id ? { ...x, includePrevidencia: e.target.checked } : x)) }))}
                        />
                        incluir previdência
                      </label>
                    ) : (
                      <span />
                    )}
                    <a className="btn small" href="#fluxo">
                      Ver investimentos no fluxo
                    </a>
                  </div>
                </>
              ) : (
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="sub">{done >= 100 ? "Meta atingida! 🎉" : `${fmt0(monthly)}/mês até ${monthLabel(g.deadline)}`}</span>
                  <button className="btn small" onClick={() => contribute(g.id)}>
                    Aportar
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <form className="card" onSubmit={add} style={{ marginTop: 16 }}>
        <h2>Nova meta</h2>
        <div className="tabs" style={{ marginBottom: 12 }}>
          <button type="button" className={form.kind === "manual" ? "on" : ""} onClick={() => setKind("manual")}>
            Valor guardado à mão
          </button>
          <button type="button" className={form.kind === "patrimonio" ? "on" : ""} onClick={() => setKind("patrimonio")}>
            💰 Patrimônio (do fluxo)
          </button>
        </div>
        {form.kind === "patrimonio" && (
          <p className="sub" style={{ marginBottom: 10 }}>
            O valor guardado vem do fluxo: soma dos investimentos{hasPrev ? " e da previdência" : ""} no mês atual, já com os rendimentos mensais e a sobra aplicada todo mês. O
            saldo em conta não entra.
          </p>
        )}
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
            <input type="text" value={form.name} placeholder={form.kind === "patrimonio" ? "ex.: Primeiro milhão" : "ex.: Troca de carro"} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="field">
            Valor alvo
            <input type="text" inputMode="decimal" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} required style={{ width: 120 }} />
          </label>
          {form.kind === "manual" ? (
            <label className="field">
              Já guardado
              <input type="text" inputMode="decimal" value={form.saved} onChange={(e) => setForm({ ...form, saved: e.target.value })} style={{ width: 120 }} />
            </label>
          ) : (
            hasPrev && (
              <label className="field" style={{ justifyContent: "flex-end" }}>
                <span className="row" style={{ gap: 6, minHeight: 36 }}>
                  <input type="checkbox" checked={form.includePrevidencia} onChange={(e) => setForm({ ...form, includePrevidencia: e.target.checked })} />
                  Incluir previdência
                </span>
              </label>
            )
          )}
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
