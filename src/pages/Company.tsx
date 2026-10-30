import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { num, useFlowGrid, type SectionMeta } from "../components/FlowGrid";
import { PageHead, Stat } from "../components/ui";
import type { Snapshot } from "../lib/analytics";
import { companyBase } from "../lib/company";
import { fmt, fmt0, fmtK, monthLabel, monthRange } from "../lib/months";
import { parseAmount } from "../lib/parse";
import { useStore } from "../lib/store";
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

  const grid = useFlowGrid<CompanyGroup>({ months, lines: company.lines, setLines, sections: SECTIONS, outflow: ["despesa"] });
  const { calcRow, section } = grid;
  const valuesOf = (id: string) => Object.fromEntries(flow.map((c) => [c.month, c.values[id] ?? 0]));

  const row = (l: CompanyLine) => {
    if (l.group === "despesa") {
      const pct = l.pctFaturamento;
      return grid.lineRow(l, {
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
      });
    }
    if (l.group === "retirada") {
      return grid.lineRow(l, {
        computed: l.auto ? valuesOf(l.id) : undefined,
        computedBase: base.perLine[l.id],
        controls: (
          <label className="row inline-opt" title="Distribuir automaticamente o resultado do mês (faturamento − despesas − demais retiradas)">
            <input type="checkbox" checked={Boolean(l.auto)} onChange={(e) => patch(l.id, { auto: e.target.checked })} />
            auto
          </label>
        ),
      });
    }
    return grid.lineRow(l);
  };
  const linesOf = (g: CompanyGroup) => company.lines.filter((l) => l.group === g).map(row);

  const first = flow[0];
  const chart = flow.map((c) => ({ mes: monthLabel(c.month), Faturamento: Math.round(c.faturamento), Despesas: Math.round(-c.despesas), Retiradas: Math.round(c.retiradas) }));
  const margem = first && first.faturamento ? first.resultado / first.faturamento : 0;
  const hasAuto = company.lines.some((l) => l.group === "retirada" && l.auto);

  return (
    <>
      <PageHead title={company.name} sub="Fluxo de caixa da empresa. Pró-labore e lucro retirados entram automaticamente como receita no fluxo pessoal.">
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

      <div className="table-wrap">
        <table className="flow">
          {grid.header}
          <tbody>
            {calcRow("Saldo inicial (caixa PJ)", flow.map((c) => c.saldoInicial), "total")}
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
    </>
  );
}
