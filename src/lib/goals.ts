import type { MonthResult } from "./cashflow";
import { addMonths } from "./months";
import type { CashflowSettings, Goal, Investment, MonthKey } from "./types";

/** Meses de `from` até `to` (0 se `to` não é depois de `from`). */
export function monthsBetween(from: MonthKey, to: MonthKey): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
}

/** Aporte mensal simples de uma meta com valor guardado à mão: o que falta dividido pelos meses. */
export function goalMonthly(goal: Goal, from: MonthKey): number {
  return Math.max(0, (goal.target - goal.saved) / Math.max(1, monthsBetween(from, goal.deadline)));
}

export interface GoalProgress {
  /** Valor guardado hoje (à mão, ou o patrimônio do mês atual no fluxo). */
  saved: number;
  /** Aporte mensal necessário até o prazo (para patrimônio, já descontando o rendimento). */
  monthly: number;
  /** Meta de patrimônio: dados vindos do fluxo. */
  auto?: {
    /** Primeiro mês em que o patrimônio projetado alcança o alvo (null se não alcança em 50 anos). */
    reachMonth: MonthKey | null;
    /** Patrimônio projetado no mês do prazo. */
    atDeadline: number;
    /** Rendimento mensal médio ponderado dos investimentos considerados. */
    rate: number;
    /** Aporte médio mensal vindo do fluxo (sobra aplicada nos investimentos). */
    contribution: number;
    /** Projeção mês a mês, do mês atual até o prazo. */
    series: { month: MonthKey; value: number }[];
  };
}

/** Patrimônio considerado pela meta: investimentos e, se marcado, previdência (o saldo em conta fica de fora). */
export const goalPatrimony = (m: MonthResult, goal: Goal) => m.totalInvestido + (goal.includePrevidencia === false ? 0 : m.previdencia);

/**
 * Progresso de uma meta. Metas de patrimônio leem o fluxo, que já aplica o rendimento mensal de cada investimento
 * e a sobra (Saldo 1) aplicada todo mês; além do horizonte do fluxo, a projeção continua com juros compostos
 * usando o rendimento médio e o aporte médio do fluxo.
 */
export function goalProgress(goal: Goal, month: MonthKey, flow: MonthResult[], settings: CashflowSettings, investments: Investment[]): GoalProgress {
  if (goal.kind !== "patrimonio" || !flow.length) return { saved: goal.saved, monthly: goalMonthly(goal, month) };

  const idx = Math.min(Math.max(0, flow.findIndex((m) => m.month === month)), flow.length - 1);
  const saved = goalPatrimony(flow[idx], goal);

  // Rendimento médio ponderado pelo saldo inicial dos investimentos considerados.
  const included = investments.filter((i) => i.kind === "investimento" || (i.kind === "previdencia" && goal.includePrevidencia !== false));
  const total = included.reduce((a, i) => a + Math.max(0, i.balance), 0);
  const rate = total > 0 ? included.reduce((a, i) => a + Math.max(0, i.balance) * i.monthlyRate, 0) / total : 0;
  // Aporte médio: o que o fluxo aplica por mês (Saldo 1, quando o resgate automático está ligado).
  const contribution = settings.sweep ? flow.reduce((a, m) => a + m.saldo1, 0) / flow.length : 0;

  // Projeção: valores do fluxo e, depois do horizonte, juros compostos com o aporte médio.
  const series = flow.slice(idx).map((m) => ({ month: m.month, value: goalPatrimony(m, goal) }));
  let reachMonth: MonthKey | null = series.find((p) => p.value >= goal.target)?.month ?? null;
  const horizon = Math.max(monthsBetween(month, goal.deadline), 1);
  for (let k = 0, last = series[series.length - 1]; series.length - 1 < horizon || (!reachMonth && k < 600); k++) {
    const next = { month: addMonths(last.month, 1), value: last.value * (1 + rate) + contribution };
    if (!reachMonth && next.value >= goal.target) reachMonth = next.month;
    // A série (gráfico) vai até o prazo; depois disso só continua a busca do mês em que alcança o alvo.
    if (series.length - 1 < horizon) series.push(next);
    last = next;
  }
  const atDeadline = series.find((p) => p.month === goal.deadline)?.value ?? series[Math.min(horizon, series.length - 1)].value;

  // Aporte mensal necessário até o prazo, com o rendimento trabalhando a favor:
  // alvo = P·(1+r)^n + A·((1+r)^n − 1)/r  ⇒  A = (alvo − P·(1+r)^n)·r / ((1+r)^n − 1)
  const n = Math.max(1, monthsBetween(month, goal.deadline));
  const g = Math.pow(1 + rate, n);
  const monthly = Math.max(0, rate > 0 ? ((goal.target - saved * g) * rate) / (g - 1) : (goal.target - saved) / n);

  return { saved, monthly, auto: { reachMonth, atDeadline, rate, contribution, series } };
}
