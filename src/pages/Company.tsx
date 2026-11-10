import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useState } from "react";
import { MonthPicker, num, useFlowGrid, type SectionMeta } from "../components/FlowGrid";
import { PageHead, Stat } from "../components/ui";
import type { Snapshot } from "../lib/analytics";
import { companyBase, companyEnabled } from "../lib/company";
import { fmt, fmt0, fmtK, monthLabel, monthRange } from "../lib/months";
import { parseAmount } from "../lib/parse";
import { useStore } from "../lib/store";
import { useMobile } from "../lib/useMobile";
import type { CompanyGroup, CompanyLine } from "../lib/types";

const SECTIONS: Record<CompanyGroup, SectionMeta> = {
  faturamento: { title: "Faturamento", hint: "notas emitidas / recebimentos da PJ", category: "Renda" },
  despesa: { title: "Despesas da empresa", hint: "digite valores positivos; impostos podem ser um % do faturamento", category: "Impostos" },
  retirada: { title: "Retiradas → fluxo pessoal", hint: "pró-labore e lucro; entram como receita no fluxo pessoal", category: "Renda" },
};

export default function Company({ snap }: { snap: Snapshot }) {
  const { state, update } = useStore();
  const { settings, company } = state;
  const months = monthRange(settings.startMonth, settings.months);
  const flow = snap.company;
  const base = companyBase(company);
  const setCompany = (fn: (c: typeof company) => typeof company) => update((s) => ({ ...s, company: fn(s.company) }));
  const setLines = (fn: (ls: CompanyLine[]) => CompanyLine[]) => setCompany((c) => ({ ...c, lines: fn(c.lines) }));
  const patch = (id: string, p: Partial<CompanyLine>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : p.auto ? { ...l, auto: false } : l)));

  const mobile = useMobile();
  const [table, setTable] = useState(false);
  const [month, setMonth] = useState(() => (months.includes(snap.month) ? snap.month : months[0]));
  const grid = useFlowGrid<CompanyGroup>({ months, lines: company.lines, setLines, sections: SECTIONS, outflow: ["despesa"], paid: snap.paid.byLine });
  const { calcRow, section } = grid;
  const valuesOf = (id: string) => Object.fromEntries(flow.map((c) => [c.month, c.values[id] ?? 0]));

  /** Opções de cada linha: despesas em % e lucro automático viram valores calculados. */
  const optsOf = (l: CompanyLine) => {
    if (l.group === "despesa") {
      const pct = l.pctFaturamento;
      return {
        computed: pct !== undefined ? valuesOf(l.id) : undefined,
        computedBase: base.perLine[l.id],
        controls: (
          <label className="row inline-opt" title="Calcular como % do faturamento do mês">
            <input
              type="text"
              inputMode="decimal"
              className="pct"
              placeholder="% fat."
              defaultValue={pct !== undefined ? num.format(pct * 100) : ""}
              key={pct ?? "none"}
              aria-label={`${l.name}: % do faturamento`}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                const v = raw ? parseAmount(raw.replace("%", "")) : undefined;
                if (v === null) return;
                const { pctFaturamento: _, ...rest } = l;
                setLines((ls) => ls.map((x) => (x.id === l.id ? (v === undefined || v === 0 ? rest : { ...rest, pctFaturamento: Math.abs(v) / 100 }) : x)));
              }}
            />
            %
          </label>
        ),
      };
    }
    if (l.group === "retirada") {
      return {
        computed: l.auto ? valuesOf(l.id) : undefined,
        computedBase: base.perLine[l.id],
        controls: (
          <label className="row inline-opt" title="Distribuir automaticamente o resultado do mês (faturamento − despesas − demais retiradas)">
            <input type="checkbox" checked={Boolean(l.auto)} onChange={(e) => patch(l.id, { auto: e.target.checked })} />
            auto
          </label>
        ),
      };
    }
    return {};
  };
  const linesOf = (g: CompanyGroup) => company.lines.filter((l) => l.group === g).map((l) => grid.lineRow(l, optsOf(l)));

  /** Celular: um mês por vez, em lista. */
  const monthView = () => {
    const c = flow[Math.max(0, months.indexOf(month))];
    if (!c) return null;
    const rows = (g: CompanyGroup) => company.lines.filter((l) => l.group === g).map((l) => grid.monthRow(l, c.month, optsOf(l)));
    return (
      <div className="card m-view">
        {grid.monthTotal("Saldo inicial (caixa PJ)", c.saldoInicial, true)}
        {c.pagas > 0 && (
          <>
            {grid.monthTotal("Despesas já pagas", -c.pagas)}
            {grid.monthTotal("Caixa da PJ agora", c.caixaAgora, true)}
          </>
        )}
        {grid.monthSection("faturamento")}
        {rows("faturamento")}
        {grid.monthTotal("Total faturamento", c.faturamento)}
        {grid.monthSection("despesa")}
        {rows("despesa")}
        {grid.monthTotal("Total despesas", c.despesas)}
        {grid.monthTotal("Resultado do mês", c.resultado, true)}
        {grid.monthSection("retirada")}
        {rows("retirada")}
        {grid.monthTotal("Total retirado → pessoal", c.retiradas)}
        {grid.monthTotal("Saldo final (caixa PJ)", c.saldoFinal, true)}
      </div>
    );
  };

  if (!companyEnabled(company)) {
    return (
      <>
        <PageHead title="Empresa" sub="Fluxo de caixa da PJ, para quem recebe pró-labore e lucro pela própria empresa." />
        <div className="card" style={{ maxWidth: 560 }}>
          <h2>O fluxo da empresa está desligado</h2>
          <p className="sub" style={{ fontSize: 14, marginBottom: 14 }}>
            Quem é CLT lança o salário direto nas Receitas do fluxo pessoal. Se você recebe pela sua empresa, ligue para lançar faturamento,
            despesas e retiradas — pró-labore e lucro entram sozinhos como receita no fluxo pessoal.
          </p>
          <button className="btn primary" onClick={() => setCompany((c) => ({ ...c, enabled: true }))}>
            Ligar fluxo da empresa
          </button>
        </div>
      </>
    );
  }

  const first = flow[0];
  const chart = flow.map((c) => ({ mes: monthLabel(c.month), Faturamento: Math.round(c.faturamento), Despesas: Math.round(-c.despesas), Retiradas: Math.round(c.retiradas) }));
  const margem = first && first.faturamento ? first.resultado / first.faturamento : 0;
  const hasAuto = company.lines.some((l) => l.group === "retirada" && l.auto);

  // No celular a lista do mês vem primeiro; parâmetros e gráfico ficam no fim.
  const settingsBlock = (
    <>
      <div className="grid g3" style={{ margin: "16px 0" }}>
        <div className="card">
          <h2>Parâmetros</h2>
          <div className="grid" style={{ gap: 10 }}>
            <label className="field">
              Nome da empresa
              <input type="text" defaultValue={company.name} onBlur={(e) => e.target.value.trim() && setCompany((c) => ({ ...c, name: e.target.value.trim() }))} />
            </label>
            <label className="field">
              Saldo inicial em caixa (PJ)
              <input
                type="text"
                key={company.openingBalance}
                defaultValue={num.format(company.openingBalance)}
                onBlur={(e) => {
                  const v = parseAmount(e.target.value);
                  if (v !== null) setCompany((c) => ({ ...c, openingBalance: v }));
                }}
              />
            </label>
            <p className="sub">
              Mês inicial e horizonte são os mesmos do fluxo pessoal ({monthLabel(settings.startMonth)}, {settings.months} meses).
            </p>
          </div>
        </div>
        <div className="card span2">
          <div className="card-head">
            <h2>Faturamento, despesas e retiradas</h2>
            <span className="sub">por mês</span>
          </div>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={chart} margin={{ left: 4, right: 8, top: 4 }} barGap={2}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="mes" axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtK} axisLine={false} tickLine={false} width={80} />
              <Tooltip formatter={(v) => fmt(Number(v))} cursor={{ fill: "var(--surface-2)" }} />
              <Legend verticalAlign="top" height={28} iconType="circle" iconSize={8} itemSorter={null} />
              <Bar dataKey="Faturamento" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={18} />
              <Bar dataKey="Despesas" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={18} />
              <Bar dataKey="Retiradas" fill="var(--series-3)" radius={[4, 4, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );

  return (
    <>
      <PageHead title={company.name} sub="Fluxo de caixa da empresa. Pró-labore e lucro retirados entram automaticamente como receita no fluxo pessoal.">
        <button
          className="btn"
          title="Para quem não é PJ: as receitas passam a vir só do fluxo pessoal"
          onClick={() =>
            confirm("Desligar o fluxo da empresa? Pró-labore e lucro deixam de entrar no fluxo pessoal (os dados da empresa ficam guardados).") &&
            setCompany((c) => ({ ...c, enabled: false }))
          }
        >
          Desligar empresa
        </button>
        <a className="btn" href="#fluxo">
          Ver fluxo pessoal →
        </a>
      </PageHead>

      <div className="grid g4">
        <Stat label={`Faturamento em ${first ? monthLabel(first.month) : "—"}`} value={first ? fmt0(first.faturamento) : "—"} />
        <Stat label="Despesas da empresa" value={first ? fmt0(-first.despesas) : "—"} tone="neg" delta={first?.faturamento ? `${Math.round((-first.despesas / first.faturamento) * 100)}% do faturamento` : undefined} />
        <Stat label="Retiradas para o pessoal" value={first ? fmt0(first.retiradas) : "—"} tone="pos" delta={`margem do resultado: ${Math.round(margem * 100)}%`} />
        <Stat
          label={`Caixa da PJ em ${flow.length ? monthLabel(flow[flow.length - 1].month) : "—"}`}
          value={flow.length ? fmt0(flow[flow.length - 1].saldoFinal) : "—"}
          tone={flow.some((c) => c.saldoFinal < 0) ? "neg" : undefined}
          delta={flow.some((c) => c.saldoFinal < 0) ? "caixa negativo em algum mês" : hasAuto ? "lucro distribuído automaticamente" : undefined}
        />
      </div>

      {!mobile && settingsBlock}

      {mobile && <MonthPicker months={months} value={month} onChange={setMonth} table={table} onTable={setTable} />}

      {mobile && !table ? (
        monthView()
      ) : (
      <div className="table-wrap">
        <table className="flow">
          {grid.header}
          <tbody>
            {calcRow("Saldo inicial (caixa PJ)", flow.map((c) => c.saldoInicial), "total")}
            {flow.some((c) => c.pagas > 0) && (
              <>
                {calcRow("Despesas já pagas (✓)", flow.map((c) => (c.pagas ? -c.pagas : 0)))}
                {calcRow("Caixa da PJ agora", flow.map((c) => c.caixaAgora), "total")}
              </>
            )}
            {section("faturamento")}
            {linesOf("faturamento")}
            {calcRow("Total faturamento", flow.map((c) => c.faturamento), "calc", base.faturamento)}
            {section("despesa")}
            {linesOf("despesa")}
            {calcRow("Total despesas", flow.map((c) => c.despesas), "calc", base.despesas)}
            {calcRow("Resultado do mês", flow.map((c) => c.resultado), "total", base.resultado)}
            {section("retirada", !hasAuto && <span className="sub"> · marque “auto” numa linha para distribuir o lucro que sobrar</span>)}
            {linesOf("retirada")}
            {calcRow("Total retirado → pessoal", flow.map((c) => c.retiradas), "calc", base.retiradas)}
            {calcRow("Saldo final (caixa PJ)", flow.map((c) => c.saldoFinal), "total", base.resultado - base.retiradas)}
          </tbody>
        </table>
      </div>
      )}
      {mobile && <div style={{ marginTop: 16 }}>{settingsBlock}</div>}
    </>
  );
}
