import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BillAlert, Insight } from "../lib/analytics";
import { fmt, fmt0, fmtK } from "../lib/months";

export function Stat({ label, value, delta, tone }: { label: string; value: string; delta?: ReactNode; tone?: "pos" | "neg" }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value ${tone ?? ""}`}>{value}</div>
      {delta && <div className="delta">{delta}</div>}
    </div>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

const tooltipMoney = (v: unknown) => fmt(Number(v));

/** Barras horizontais por categoria. Uma ou duas séries (ex.: realizado x planejado). */
export function CategoryBars({
  data,
  series,
  height,
}: {
  data: Record<string, string | number>[];
  series: { key: string; label: string; color: string }[];
  height?: number;
}) {
  if (!data.length) return <div className="empty">Sem dados para o período.</div>;
  const h = height ?? Math.max(160, data.length * (series.length > 1 ? 34 : 26) + 40);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }} barGap={2} barCategoryGap={series.length > 1 ? "22%" : "28%"}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickFormatter={fmtK} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" width={92} axisLine={false} tickLine={false} />
        <Tooltip formatter={tooltipMoney} cursor={{ fill: "var(--surface-2)" }} />
        {series.length > 1 && <Legend verticalAlign="top" height={28} iconType="circle" iconSize={8} itemSorter={null} />}
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[0, 4, 4, 0]} maxBarSize={14} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function InsightList({ items }: { items: Insight[] }) {
  if (!items.length) return <div className="empty">Nenhuma recomendação no momento.</div>;
  return (
    <div className="list">
      {items.map((i, k) => (
        <div className="list-item" key={k} style={{ alignItems: "flex-start" }}>
          <span className={`chip ${i.prioridade}`}>{i.prioridade === "media" ? "média" : i.prioridade}</span>
          <div className="grow">
            <h3>{i.titulo}</h3>
            <p className="sub" style={{ fontSize: 13, color: "var(--text-2)" }}>
              {i.detalhe}
            </p>
          </div>
          {i.impactoMensal ? <span className="sub">{fmt0(Math.abs(i.impactoMensal))}/mês</span> : null}
        </div>
      ))}
    </div>
  );
}

const STATUS_LABEL: Record<BillAlert["status"], string> = {
  atrasada: "atrasada",
  "vence-hoje": "vence hoje",
  proxima: "em breve",
  ok: "em dia",
  paga: "paga",
};
const STATUS_ICON: Record<BillAlert["status"], string> = { atrasada: "⚠", "vence-hoje": "⏰", proxima: "⏰", ok: "•", paga: "✓" };

export function BillStatus({ alert }: { alert: BillAlert }) {
  return (
    <span className={`chip ${alert.status}`}>
      <span aria-hidden>{STATUS_ICON[alert.status]}</span>
      {STATUS_LABEL[alert.status]}
    </span>
  );
}

export function dueText(a: BillAlert): string {
  if (a.status === "paga") return `pago · vence dia ${a.bill.dueDay}`;
  if (a.daysLeft < 0) return `venceu há ${-a.daysLeft} ${a.daysLeft === -1 ? "dia" : "dias"}`;
  if (a.daysLeft === 0) return "vence hoje";
  return `vence em ${a.daysLeft} ${a.daysLeft === 1 ? "dia" : "dias"} (dia ${a.bill.dueDay})`;
}
