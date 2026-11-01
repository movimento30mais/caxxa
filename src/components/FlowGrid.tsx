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

  /* ---------- Visão por mês (celular): uma coluna, um mês de cada vez ---------- */

  /** Linha editável do mês: nome à esquerda, valor à direita; Base e controles extras embaixo. */
  const monthRow = (l: FlowLine<G>, month: MonthKey, opts: RowOptions = {}) => (
    <div className="m-row" key={l.id}>
      <div className="m-row-main">
        <input
          className="m-name"
          defaultValue={l.name}
          aria-label="Nome da linha"
          onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && setLine(l.id, (x) => ({ ...x, name: e.target.value.trim() }))}
        />
        {opts.computed ? (
          <span className={`m-value computed-value ${(opts.computed[month] ?? 0) < 0 ? "neg" : ""}`}>{show(opts.computed[month]) || "0,00"}</span>
        ) : (
          <input
            key={`${month}:${l.values[month] ?? ""}`}
            className={`m-value ${(l.values[month] ?? 0) < 0 ? "neg" : ""}`}
            inputMode="decimal"
            placeholder="0,00"
            defaultValue={show(l.values[month])}
            aria-label={`${l.name} ${monthLabel(month)}`}
            onBlur={(e) => commitCell(l, month, e.target.value, e.target)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        )}
      </div>
      <div className="m-row-sub">
        <span>
          Base {opts.computed ? showBase(opts.computedBase) || "—" : showBase(l.base) || "—"}
        </span>
        {opts.controls}
        <span className="m-actions">
          {!opts.computed && (
            <button className="btn ghost small" onClick={() => fillRight(l)} title="Repetir em todos os meses">
              ⇥ todos os meses
            </button>
          )}
          <button className="btn ghost small" aria-label={`Excluir ${l.name}`} onClick={() => confirm(`Excluir "${l.name}"?`) && setLines((ls) => ls.filter((x) => x.id !== l.id))}>
            ✕
          </button>
        </span>
      </div>
    </div>
  );

  const monthTotal = (label: ReactNode, value: number, strong = false) => (
    <div className={`m-total ${strong ? "strong" : ""}`}>
      <span>{label}</span>
      <span className={value < 0 ? "neg" : undefined}>{num.format(value)}</span>
    </div>
  );

  const monthSection = (group: G) => {
    const meta = sections[group];
    return (
      <div className="m-section">
        <span>{meta.title}</span>
        <button className="btn small" onClick={() => setLines((ls) => [...ls, { id: uid("l"), name: "Nova linha", group, category: meta.category, values: {} }])}>
          + linha
        </button>
      </div>
    );
  };

  return { header, calcRow, lineRow, section, sectionRow, baseSum, monthRow, monthTotal, monthSection };
}

/** Seletor de mês do celular: ‹ nov/26 › e alternância entre a visão por mês e a tabela. */
export function MonthPicker({ months, value, onChange, table, onTable }: { months: MonthKey[]; value: MonthKey; onChange: (m: MonthKey) => void; table: boolean; onTable: (t: boolean) => void }) {
  const i = Math.max(0, months.indexOf(value));
  return (
    <div className="m-picker">
      {!table && (
        <div className="m-picker-month">
          <button className="btn" disabled={i === 0} onClick={() => onChange(months[i - 1])} aria-label="Mês anterior">
            ‹
          </button>
          <select value={months[i]} onChange={(e) => onChange(e.target.value)} aria-label="Mês">
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <button className="btn" disabled={i === months.length - 1} onClick={() => onChange(months[i + 1])} aria-label="Próximo mês">
            ›
          </button>
        </div>
      )}
      <div className="tabs">
        <button className={!table ? "on" : ""} onClick={() => onTable(false)}>
          Mês
        </button>
        <button className={table ? "on" : ""} onClick={() => onTable(true)}>
          Tabela
        </button>
      </div>
    </div>
  );
}
