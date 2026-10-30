import type { ReactNode } from "react";
import { CATEGORY_NAMES } from "../lib/categories";
import { monthLabel } from "../lib/months";
import { parseAmount } from "../lib/parse";
import { uid } from "../lib/seed";
import type { FlowLine, MonthKey } from "../lib/types";

export const num = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const show = (v: number | undefined) => (v ? num.format(v) : "");
const showBase = (v: number | undefined) => (v === undefined ? "" : num.format(v));

export interface SectionMeta {
  title: string;
  hint: string;
  category: string;
}

interface Options<G extends string> {
  months: MonthKey[];
  lines: FlowLine<G>[];
  setLines: (fn: (ls: FlowLine<G>[]) => FlowLine<G>[]) => void;
  sections: Record<G, SectionMeta>;
  /** Grupos em que o valor digitado é sempre uma saída (gravado negativo). */
  outflow: G[];
}

interface RowOptions {
  /** Valores calculados (somente leitura), ex.: % do faturamento ou lucro automático. */
  computed?: Record<MonthKey, number>;
  computedBase?: number;
  /** Controles extras ao lado do nome. */
  controls?: ReactNode;
}

/**
 * Peças da grade mês a mês (cabeçalho, seções, linhas editáveis com coluna Base e linhas calculadas),
 * usadas pelo fluxo pessoal e pelo fluxo da empresa.
 */
export function useFlowGrid<G extends string>({ months, lines, setLines, sections, outflow }: Options<G>) {
  const setLine = (id: string, fn: (l: FlowLine<G>) => FlowLine<G>) => setLines((ls) => ls.map((l) => (l.id === id ? fn(l) : l)));

  /** Grava uma célula de mês ou, com month = "base", a coluna Base (orçamento mensal). */
  const commitCell = (line: FlowLine<G>, month: string, raw: string, el: HTMLInputElement) => {
    const isBase = month === "base";
    const current = isBase ? line.base : line.values[month];
    const parsed = parseAmount(raw);
    if (parsed === null) {
      el.value = isBase ? showBase(current) : show(current);
      return;
    }
    // Base vazia = sem orçamento; Base 0 = orçamento zero.
    const v = isBase && !raw.trim() ? undefined : outflow.includes(line.group) ? -Math.abs(parsed) : parsed;
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
  const fillRight = (line: FlowLine<G>) => {
    const v = line.base ?? line.values[months[0]] ?? 0;
    setLine(line.id, (l) => {
      const values = { ...l.values };
      for (const m of months) v ? (values[m] = v) : delete values[m];
      return { ...l, values };
    });
  };

  const baseSum = (...groups: G[]) => lines.reduce((a, l) => (groups.includes(l.group) ? a + (l.base ?? 0) : a), 0);

  const header = (
    <thead>
      <tr>
        <th className="name">Linha</th>
        <th className="base" title="Orçamento mensal de cada linha (coluna Base da planilha)">
          Base
        </th>
        {months.map((m) => (
          <th key={m}>{monthLabel(m)}</th>
        ))}
      </tr>
    </thead>
  );

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

  const cellInput = (l: FlowLine<G>, key: string, value: number | undefined, label: string, display: (v: number | undefined) => string) => (
    <input
      key={`${key}:${value ?? ""}`}
      className={`cell ${(value ?? 0) < 0 ? "neg" : ""}`}
      defaultValue={display(value)}
      aria-label={label}
      onBlur={(e) => commitCell(l, key, e.target.value, e.target)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );

  const lineRow = (l: FlowLine<G>, opts: RowOptions = {}) => (
    <tr key={l.id} className={opts.computed ? "computed" : undefined}>
      <td className="name">
        <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
          <input
            className="name-input"
            defaultValue={l.name}
            aria-label="Nome da linha"
            onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && setLine(l.id, (x) => ({ ...x, name: e.target.value.trim() }))}
          />
          {opts.controls ?? (
            <select className="cat" value={l.category} aria-label="Categoria" onChange={(e) => setLine(l.id, (x) => ({ ...x, category: e.target.value }))}>
              {CATEGORY_NAMES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
          <span className="line-actions">
            {!opts.computed && (
              <button className="btn ghost small" title={l.base !== undefined ? "Aplicar a Base em todos os meses" : "Repetir o valor do 1º mês em todos os meses"} onClick={() => fillRight(l)}>
                ⇥
              </button>
            )}
            <button className="btn ghost small" title="Excluir linha" onClick={() => confirm(`Excluir "${l.name}"?`) && setLines((ls) => ls.filter((x) => x.id !== l.id))}>
              ✕
            </button>
          </span>
        </div>
      </td>
      <td className="base">
        {opts.computed ? (
          <span className={`computed-value ${(opts.computedBase ?? 0) < 0 ? "neg" : ""}`}>{showBase(opts.computedBase)}</span>
        ) : (
          cellInput(l, "base", l.base, `${l.name} base (orçamento mensal)`, showBase)
        )}
      </td>
      {months.map((m) => (
        <td key={m}>
          {opts.computed ? (
            <span className={`computed-value ${(opts.computed[m] ?? 0) < 0 ? "neg" : ""}`}>{show(opts.computed[m])}</span>
          ) : (
            cellInput(l, m, l.values[m], `${l.name} ${monthLabel(m)}`, show)
          )}
        </td>
      ))}
    </tr>
  );

  const section = (group: G, extra?: ReactNode) => {
    const meta = sections[group];
    return (
      <tr className="section">
        <td className="name">
          {meta.title}{" "}
          <button
            className="btn small"
            style={{ marginLeft: 6, textTransform: "none", letterSpacing: 0 }}
            onClick={() => setLines((ls) => [...ls, { id: uid("l"), name: "Nova linha", group, category: meta.category, values: {} }])}
          >
            + linha
          </button>
        </td>
        <td colSpan={months.length + 1} style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
          <span className="sub">{meta.hint}</span>
          {extra}
        </td>
      </tr>
    );
  };

  const sectionRow = (title: ReactNode) => (
    <tr className="section">
      <td className="name">{title}</td>
      <td colSpan={months.length + 1} />
    </tr>
  );

  return { header, calcRow, lineRow, section, sectionRow, baseSum };
}
