import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PageId } from "../App";
import { BillStatus, CategoryBars, InsightList, PageHead, Stat, dueText } from "../components/ui";
import { goalMonthly, localInsights, type Snapshot } from "../lib/analytics";
import { fmt, fmt0, fmtK, monthLabel } from "../lib/months";
import { useStore } from "../lib/store";

export default function Dashboard({ snap, go }: { snap: Snapshot; go: (p: PageId) => void }) {
  const { state } = useStore();
  const { flow, actual, planned, history, alerts } = snap;
  const first = flow[0];
  const last = flow[flow.length - 1];
  const gasto = Object.values(actual).reduce((a, b) => a + b, 0);
  const plan = Object.values(planned).reduce((a, b) => a + b, 0);
  const pending = alerts.filter((a) => a.status !== "paga");
  const pendingSoon = pending.filter((a) => a.daysLeft <= 7);

  const cats = [...new Set([...Object.keys(actual), ...Object.keys(planned)])]
    .map((name) => ({ name, realizado: Math.round(actual[name] ?? 0), orcamento: Math.round(planned[name] ?? 0) }))
    .sort((a, b) => b.orcamento + b.realizado - (a.orcamento + a.realizado));

  const hasPrev = flow.some((m) => m.previdencia > 0);
  const proj = flow.map((m) => ({ mes: monthLabel(m.month), Investimentos: Math.round(m.totalInvestido), Previdência: Math.round(m.previdencia) }));
  const hist = history.map((h) => ({ mes: monthLabel(h.month), Receitas: Math.round(h.receitas), Despesas: Math.round(h.despesas) }));

  return (
    <>
      <PageHead title="Painel" sub={`Visão de ${monthLabel(snap.month)} e projeção de ${flow.length} meses`} />


      <div className="grid g4">
        <Stat
          label={`Gastos em ${monthLabel(snap.month)}`}
          value={fmt0(gasto)}
          tone={plan && gasto > plan ? "neg" : undefined}
          delta={plan ? `${Math.round((gasto / plan) * 100)}% do orçamento (${fmt0(plan)})` : "sem orçamento na coluna Base"}
        />
        <Stat
          label="Sobra do mês (Saldo 1)"
          value={first ? fmt0(first.saldo1) : "—"}
          tone={first && first.saldo1 < 0 ? "neg" : "pos"}
          delta={first && first.saldo1 < 0 ? "resgate dos investimentos" : "vai para os investimentos"}
        />
        <Stat
          label={`Patrimônio em ${last ? monthLabel(last.month) : "—"}`}
          value={last ? fmtK(last.patrimonio) : "—"}
          delta={first && last ? `${last.patrimonio >= first.patrimonio ? "+" : ""}${fmt0(last.patrimonio - first.patrimonio)} no período` : undefined}
        />
        <Stat
          label="Contas nos próximos 7 dias"
          value={String(pendingSoon.length)}
          tone={pending.some((a) => a.status === "atrasada") ? "neg" : undefined}
          delta={`${fmt0(pendingSoon.reduce((a, b) => a + b.bill.amount, 0))} a pagar`}
        />
      </div>

      <div className="grid g3" style={{ marginTop: 16 }}>
        <div className="card span2">
          <div className="card-head">
            <h2>Despesas por categoria</h2>
            <span className="sub">{monthLabel(snap.month)} · realizado x orçamento (Base)</span>
          </div>
          <CategoryBars
            data={cats}
            series={[
              { key: "realizado", label: "Realizado", color: "var(--series-1)" },
              { key: "orcamento", label: "Orçamento (Base)", color: "var(--series-2)" },
            ]}
          />
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Recomendações</h2>
            <button className="btn small" onClick={() => go("ia")}>
              Assistente IA →
            </button>
          </div>
          <InsightList items={localInsights(state, snap).slice(0, 3)} />
        </div>

        <div className="card span2">
          <div className="card-head">
            <h2>Patrimônio projetado</h2>
            <span className="sub">rendimento mensal + sobras aplicadas</span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={proj} margin={{ left: 4, right: 12, top: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="mes" axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtK} axisLine={false} tickLine={false} width={80} />
              <Tooltip formatter={(v) => fmt(Number(v))} />
              {hasPrev && <Legend verticalAlign="top" height={28} iconType="circle" iconSize={8} itemSorter={null} />}
              <Area type="monotone" dataKey="Investimentos" stackId="1" stroke="var(--series-1)" fill="var(--series-1)" fillOpacity={0.18} strokeWidth={2} />
              {hasPrev && <Area type="monotone" dataKey="Previdência" stackId="1" stroke="var(--series-2)" fill="var(--series-2)" fillOpacity={0.18} strokeWidth={2} />}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Vencimentos</h2>
            <button className="btn small" onClick={() => go("contas")}>
              Ver todas
            </button>
          </div>
          <div className="list">
            {pending.slice(0, 5).map((a) => (
              <div className="list-item" key={a.bill.id}>
                <div className="grow">
                  <div className="ellipsis">{a.bill.name}</div>
                  <div className="sub">{dueText(a)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div>{fmt(a.bill.amount)}</div>
                  <BillStatus alert={a} />
                </div>
              </div>
            ))}
            {!pending.length && <div className="empty">Tudo pago este mês 🎉</div>}
          </div>
        </div>

        <div className="card span2">
          <div className="card-head">
            <h2>Receitas x despesas</h2>
            <span className="sub">lançamentos dos últimos meses</span>
          </div>
          {hist.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={hist} margin={{ left: 4, right: 12, top: 4 }} barGap={2}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="mes" axisLine={false} tickLine={false} />
                <YAxis tickFormatter={fmtK} axisLine={false} tickLine={false} width={80} />
                <Tooltip formatter={(v) => fmt(Number(v))} cursor={{ fill: "var(--surface-2)" }} />
                <Legend verticalAlign="top" height={28} iconType="circle" iconSize={8} itemSorter={null} />
                <Bar dataKey="Receitas" fill="var(--series-3)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="Despesas" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty">Registre lançamentos ou conecte um banco para ver o histórico.</div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Metas</h2>
            <button className="btn small" onClick={() => go("metas")}>
              Gerenciar
            </button>
          </div>
          <div className="list">
            {state.goals.map((g) => (
              <div className="list-item" key={g.id} style={{ display: "block" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="ellipsis">
                    {g.icon} {g.name}
                  </span>
                  <span className="sub">{Math.round((g.saved / g.target) * 100)}%</span>
                </div>
                <div className="progress" style={{ margin: "6px 0 4px" }}>
                  <div style={{ width: `${Math.min(100, (g.saved / g.target) * 100)}%` }} />
                </div>
                <div className="sub">
                  {fmt0(g.saved)} de {fmt0(g.target)} · {fmt0(goalMonthly(g, snap.month))}/mês até {monthLabel(g.deadline)}
                </div>
              </div>
            ))}
            {!state.goals.length && <div className="empty">Nenhuma meta criada.</div>}
          </div>
        </div>
      </div>
    </>
  );
}
