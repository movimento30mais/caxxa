import { useRef, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHead } from "../components/ui";
import type { Snapshot } from "../lib/analytics";
import { api } from "../lib/api";
import { CATEGORY_NAMES } from "../lib/categories";
import { fmt, fmtK, monthLabel, monthRange } from "../lib/months";
import { parseAmount } from "../lib/parse";
import { uid } from "../lib/seed";
import { useStore } from "../lib/store";
import type { FlowLine, Investment, LineGroup } from "../lib/types";

const num = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const show = (v: number | undefined) => (v ? num.format(v) : "");
const showBase = (v: number | undefined) => (v === undefined ? "" : num.format(v));

const SECTIONS: { group: LineGroup; title: string; hint: string }[] = [
  { group: "pessoal", title: "Despesas pessoais", hint: "digite valores positivos; entram como saída" },
  { group: "renda", title: "Receitas", hint: "salário, férias, 13º" },
  { group: "empresa", title: "Despesas da empresa (PJ)", hint: "impostos, INSS, contabilidade" },
  { group: "extra", title: "Outros lançamentos", hint: "use sinal negativo para saídas" },
];

export default function Cashflow({ snap }: { snap: Snapshot }) {
  const { state, update } = useStore();
  const { settings, lines, investments } = state;
  const months = monthRange(settings.startMonth, settings.months);
  const flow = snap.flow;
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const setLine = (id: string, fn: (l: FlowLine) => FlowLine) => update((s) => ({ ...s, lines: s.lines.map((l) => (l.id === id ? fn(l) : l)) }));
  const setInv = (id: string, patch: Partial<Investment>) =>
    update((s) => ({
      ...s,
      investments: s.investments.map((i) => (i.id === id ? { ...i, ...patch } : patch.sweepTarget ? { ...i, sweepTarget: false } : i)),
    }));

  /** Grava uma célula de mês ou, com month = "base", a coluna Base (orçamento mensal). */
  const commitCell = (line: FlowLine, month: string, raw: string, el: HTMLInputElement) => {
    const isBase = month === "base";
    const current = isBase ? line.base : line.values[month];
    const parsed = parseAmount(raw);
    if (parsed === null) {
      el.value = isBase ? showBase(current) : show(current);
      return;
    }
    // Base vazia = sem orçamento; Base 0 = orçamento zero.
    const v = isBase && !raw.trim() ? undefined : line.group === "pessoal" || line.group === "empresa" ? -Math.abs(parsed) : parsed;
    el.value = isBase ? showBase(v) : show(v);
    if (isBase ? current === v : (current ?? 0) === v) return;
    setLine(line.id, (l) => {
      if (isBase) {
        const { base: _, ...rest } = l;
        return v === undefined ? rest : { ...rest, base: v };
      }
      const values = { ...l.values };
      if (v) values[month] = v;
      else delete values[month];
      return { ...l, values };
    });
  };

  /** Repete a Base (ou, sem Base, o valor do 1º mês) em todos os meses. */
  const fillRight = (line: FlowLine) => {
    const v = line.base ?? line.values[months[0]] ?? 0;
    setLine(line.id, (l) => {
      const values = { ...l.values };
      for (const m of months) v ? (values[m] = v) : delete values[m];
      return { ...l, values };
    });
  };

  const baseSum = (...groups: LineGroup[]) => lines.reduce((a, l) => (groups.includes(l.group) ? a + (l.base ?? 0) : a), 0);

  const addLine = (group: LineGroup) =>
    update((s) => ({
      ...s,
      lines: [...s.lines, { id: uid("l"), name: "Nova linha", group, category: group === "renda" ? "Renda" : group === "empresa" ? "Impostos" : "Diversos", values: {} }],
    }));

  async function importFile(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.importXlsx(file);
      update((s) => ({ ...s, settings: r.settings, lines: r.lines, investments: r.investments.length ? r.investments : s.investments }));
      setMsg({ kind: "ok", text: `Importado da aba "${r.sheet}": ${r.lines.length} linhas e ${r.investments.length} investimentos, de ${monthLabel(r.settings.startMonth)} em diante.` });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const calcRow = (label: ReactNode, values: number[], cls = "calc", base?: number) => (
    <tr className={cls}>
      <td className="name">{label}</td>
      <td className={`base ${base !== undefined && base < 0 ? "neg" : ""}`}>{base !== undefined ? num.format(base) : ""}</td>
      {values.map((v, i) => (
        <td key={i} className={v < 0 ? "neg" : undefined}>
          {num.format(v)}
        </td>
      ))}
    </tr>
  );

  const lineRow = (l: FlowLine) => (
    <tr key={l.id}>
      <td className="name">
        <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
          <input
            className="name-input"
            defaultValue={l.name}
            aria-label="Nome da linha"
            onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && setLine(l.id, (x) => ({ ...x, name: e.target.value.trim() }))}
          />
          <select className="cat" value={l.category} aria-label="Categoria" onChange={(e) => setLine(l.id, (x) => ({ ...x, category: e.target.value }))}>
            {CATEGORY_NAMES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <span className="line-actions">
            <button className="btn ghost small" title={l.base !== undefined ? "Aplicar a Base em todos os meses" : "Repetir o valor do 1º mês em todos os meses"} onClick={() => fillRight(l)}>
              ⇥
            </button>
            <button
              className="btn ghost small"
              title="Excluir linha"
              onClick={() => confirm(`Excluir "${l.name}"?`) && update((s) => ({ ...s, lines: s.lines.filter((x) => x.id !== l.id) }))}
            >
              ✕
            </button>
          </span>
        </div>
      </td>
      <td className="base">
        <input
          key={`base:${l.base ?? ""}`}
          className={`cell ${(l.base ?? 0) < 0 ? "neg" : ""}`}
          defaultValue={showBase(l.base)}
          aria-label={`${l.name} base (orçamento mensal)`}
          onBlur={(e) => commitCell(l, "base", e.target.value, e.target)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </td>
      {months.map((m) => (
        <td key={m}>
          <input
            key={`${m}:${l.values[m] ?? 0}`}
            className={`cell ${(l.values[m] ?? 0) < 0 ? "neg" : ""}`}
            defaultValue={show(l.values[m])}
            aria-label={`${l.name} ${monthLabel(m)}`}
            onBlur={(e) => commitCell(l, m, e.target.value, e.target)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </td>
      ))}
    </tr>
  );

  const section = (group: LineGroup) => {
    const meta = SECTIONS.find((s) => s.group === group)!;
    const ls = lines.filter((l) => l.group === group);
    return (
      <>
        <tr className="section">
          <td className="name">
            {meta.title}{" "}
            <button className="btn small" style={{ marginLeft: 6, textTransform: "none", letterSpacing: 0 }} onClick={() => addLine(group)}>
              + linha
            </button>
          </td>
          <td colSpan={months.length + 1} style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
            <span className="sub">{meta.hint}</span>
          </td>
        </tr>
        {ls.map(lineRow)}
      </>
    );
  };

  const invRows = investments.filter((i) => i.kind === "investimento");
  const prevRows = investments.filter((i) => i.kind === "previdencia");
  const chart = flow.map((m) => ({ mes: monthLabel(m.month), v: Math.round(m.saldo1) }));

  return (
    <>
      <PageHead title="Fluxo de caixa" sub="Planejamento mensal no mesmo modelo da sua planilha: despesas, resgate, salário e investimentos.">
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
          <thead>
            <tr>
              <th className="name">Linha</th>
              <th className="base" title="Orçamento mensal de cada linha (coluna Base da planilha)">Base</th>
              {months.map((m) => (
                <th key={m}>{monthLabel(m)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {calcRow("Saldo inicial", flow.map((m) => m.saldoInicial), "total")}
            {section("pessoal")}
            {calcRow("Saldo 1", flow.map((m) => m.saldo1), "total", baseSum("pessoal", "renda"))}
            {settings.sweep && calcRow("Resgate (−aplicação / +resgate)", flow.map((m) => m.resgate))}
            {calcRow("Saldo 2", flow.map((m) => m.saldo2))}
            {section("renda")}
            {section("empresa")}
            {calcRow("Total empresa", flow.map((m) => m.empresa), "calc", baseSum("empresa"))}
            {section("extra")}
            {calcRow("Saldo final", flow.map((m) => m.saldoFinal), "total", baseSum("pessoal", "renda", "empresa", "extra"))}
            <tr className="section">
              <td className="name">Investimentos</td>
              <td colSpan={months.length + 1} />
            </tr>
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
