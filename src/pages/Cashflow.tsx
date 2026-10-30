import { useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { num, useFlowGrid, type SectionMeta } from "../components/FlowGrid";
import { PageHead } from "../components/ui";
import type { Snapshot } from "../lib/analytics";
import { api } from "../lib/api";
import { companyBase } from "../lib/company";
import { fmt, fmtK, monthLabel, monthRange } from "../lib/months";
import { parseAmount } from "../lib/parse";
import { uid } from "../lib/seed";
import { useStore } from "../lib/store";
import type { FlowLine, Investment, LineGroup } from "../lib/types";

const SECTIONS: Record<LineGroup, SectionMeta> = {
  pessoal: { title: "Despesas pessoais", hint: "digite valores positivos; entram como saída", category: "Diversos" },
  renda: { title: "Receitas", hint: "receitas pessoais (13º, férias, aluguéis); as retiradas da empresa entram sozinhas", category: "Renda" },
  extra: { title: "Outros lançamentos", hint: "use sinal negativo para saídas", category: "Diversos" },
};

export default function Cashflow({ snap }: { snap: Snapshot }) {
  const { state, update } = useStore();
  const { settings, lines, investments, company } = state;
  const months = monthRange(settings.startMonth, settings.months);
  const flow = snap.flow;
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const grid = useFlowGrid<LineGroup>({
    months,
    lines,
    setLines: (fn) => update((s) => ({ ...s, lines: fn(s.lines) })),
    sections: SECTIONS,
    outflow: ["pessoal"],
  });
  const { calcRow, section } = grid;
  const setInv = (id: string, patch: Partial<Investment>) =>
    update((s) => ({
      ...s,
      investments: s.investments.map((i) => (i.id === id ? { ...i, ...patch } : patch.sweepTarget ? { ...i, sweepTarget: false } : i)),
    }));

  // Retiradas da empresa (pró-labore, lucro) entram como receitas, somente leitura aqui.
  const withdrawals = company.lines.filter((l) => l.group === "retirada");
  const cBase = companyBase(company);
  const linesOf = (g: LineGroup) => lines.filter((l: FlowLine) => l.group === g).map((l) => grid.lineRow(l));

  async function importFile(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.importXlsx(file);
      update((s) => ({ ...s, settings: r.settings, lines: r.lines, company: r.company, investments: r.investments.length ? r.investments : s.investments }));
      setMsg({
        kind: "ok",
        text: `Importado da aba "${r.sheet}": ${r.lines.length} linhas pessoais, ${r.company.lines.length} da empresa e ${r.investments.length} investimentos, de ${monthLabel(r.settings.startMonth)} em diante. O "Salário" da planilha virou o faturamento da empresa; confira em Empresa.`,
      });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const invRows = investments.filter((i) => i.kind === "investimento");
  const prevRows = investments.filter((i) => i.kind === "previdencia");
  const chart = flow.map((m) => ({ mes: monthLabel(m.month), v: Math.round(m.saldo1) }));

  return (
    <>
      <PageHead title="Fluxo de caixa pessoal" sub="Fluxo pessoal no modelo da sua planilha: despesas, resgate, receitas (incluindo as retiradas da empresa) e investimentos.">
        <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? "Importando…" : "Importar planilha (.xlsx)"}
        </button>
      </PageHead>

      {msg && (
        <div className={`notice ${msg.kind === "err" ? "err" : ""}`} style={{ marginBottom: 12 }}>
          {msg.text}
        </div>
      )}

      <div className="grid g3" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>Parâmetros</h2>
          <div className="grid g2" style={{ gap: 10 }}>
            <label className="field">
              Mês inicial
              <input type="month" value={settings.startMonth} onChange={(e) => e.target.value && update((s) => ({ ...s, settings: { ...s.settings, startMonth: e.target.value } }))} />
            </label>
            <label className="field">
              Horizonte
              <select value={settings.months} onChange={(e) => update((s) => ({ ...s, settings: { ...s.settings, months: Number(e.target.value) } }))}>
                {[6, 12, 18, 24, 36].map((n) => (
                  <option key={n} value={n}>
                    {n} meses
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Saldo inicial em conta
              <input
                type="text"
                key={settings.openingBalance}
                defaultValue={num.format(settings.openingBalance)}
                onBlur={(e) => {
                  const v = parseAmount(e.target.value);
                  if (v !== null) update((s) => ({ ...s, settings: { ...s.settings, openingBalance: v } }));
                }}
              />
            </label>
            <label className="field" style={{ justifyContent: "flex-end" }}>
              <span className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={settings.sweep} onChange={(e) => update((s) => ({ ...s, settings: { ...s.settings, sweep: e.target.checked } }))} />
                Resgate automático
              </span>
              <span className="sub">aplica a sobra / cobre o déficit</span>
            </label>
          </div>
        </div>
        <div className="card span2">
          <div className="card-head">
            <h2>Saldo 1 por mês</h2>
            <span className="sub">acima de zero: aplicação · abaixo: resgate dos investimentos</span>
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={chart} margin={{ left: 4, right: 8, top: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="mes" axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtK} axisLine={false} tickLine={false} width={80} />
              <ReferenceLine y={0} stroke="var(--muted)" />
              <Tooltip formatter={(v) => [fmt(Number(v)), "Saldo 1"]} cursor={{ fill: "var(--surface-2)" }} />
              <Bar dataKey="v" fill="var(--series-1)" radius={4} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="table-wrap">
        <table className="flow">
          {grid.header}
          <tbody>
            {calcRow("Saldo inicial", flow.map((m) => m.saldoInicial), "total")}
            {section("pessoal")}
            {linesOf("pessoal")}
            {calcRow("Saldo 1", flow.map((m) => m.saldo1), "total", grid.baseSum("pessoal"))}
            {settings.sweep && calcRow("Resgate (−aplicação / +resgate)", flow.map((m) => m.resgate))}
            {calcRow("Saldo 2", flow.map((m) => m.saldo2))}
            {section("renda")}
            {withdrawals.map((w) => (
              <tr key={w.id} className="calc linked">
                <td className="name">
                  {w.name}{" "}
                  <a href="#empresa" className="sub">
                    ↗ {company.name}
                  </a>
                </td>
                <td className="base">{num.format(cBase.perLine[w.id] ?? 0)}</td>
                {snap.company.map((c) => (
                  <td key={c.month}>{c.values[w.id] ? num.format(c.values[w.id]) : ""}</td>
                ))}
              </tr>
            ))}
            {linesOf("renda")}
            {calcRow("Receitas do mês", flow.map((m) => m.renda + m.retiradas), "calc", grid.baseSum("renda") + cBase.retiradas)}
            {section("extra")}
            {linesOf("extra")}
            {calcRow("Saldo final", flow.map((m) => m.saldoFinal), "total", grid.baseSum("pessoal", "renda", "extra") + cBase.retiradas)}
            {grid.sectionRow("Investimentos")}
            {invRows.map((i) => calcRow(`${i.name}${i.sweepTarget ? " ⇄" : ""}`, flow.map((m) => m.investimentos[i.id])))}
            {calcRow("Total investido", flow.map((m) => m.totalInvestido), "total")}
            {prevRows.map((i) => calcRow(i.name, flow.map((m) => m.investimentos[i.id])))}
            {calcRow("Patrimônio (conta + investimentos + previdência)", flow.map((m) => m.patrimonio), "total")}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h2>Investimentos</h2>
          <button
            className="btn small"
            onClick={() =>
              update((s) => ({
                ...s,
                investments: [...s.investments, { id: uid("i"), name: "Nova aplicação", balance: 0, monthlyRate: 0.005, sweepTarget: !s.investments.some((i) => i.sweepTarget), kind: "investimento" }],
              }))
            }
          >
            + aplicação
          </button>
        </div>
        <div className="list">
          {investments.map((i) => (
            <div className="list-item" key={i.id}>
              <input type="text" className="grow" defaultValue={i.name} aria-label="Nome" onBlur={(e) => e.target.value.trim() && setInv(i.id, { name: e.target.value.trim() })} />
              <label className="field">
                Saldo no início
                <input
                  type="text"
                  style={{ width: 130 }}
                  key={i.balance}
                  defaultValue={num.format(i.balance)}
                  onBlur={(e) => {
                    const v = parseAmount(e.target.value);
                    if (v !== null) setInv(i.id, { balance: v });
                  }}
                />
              </label>
              <label className="field">
                % ao mês
                <input
                  type="number"
                  step="0.05"
                  style={{ width: 80 }}
                  value={Math.round(i.monthlyRate * 10000) / 100}
                  onChange={(e) => setInv(i.id, { monthlyRate: Number(e.target.value) / 100 })}
                />
              </label>
              <label className="field">
                Tipo
                <select value={i.kind} onChange={(e) => setInv(i.id, { kind: e.target.value as Investment["kind"], sweepTarget: false })}>
                  <option value="investimento">Investimento</option>
                  <option value="previdencia">Previdência</option>
                </select>
              </label>
              <label className="field" title="Recebe as aplicações e resgates do Saldo 1">
                Resgate ⇄
                <input type="radio" name="sweep" checked={i.sweepTarget} disabled={i.kind !== "investimento"} onChange={() => setInv(i.id, { sweepTarget: true })} />
              </label>
              <button className="btn ghost small" title="Excluir" onClick={() => confirm(`Excluir "${i.name}"?`) && update((s) => ({ ...s, investments: s.investments.filter((x) => x.id !== i.id) }))}>
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
