import { computeCashflow, plannedByCategory, type MonthResult } from "./cashflow";
import { companyEnabled, computeCompany, type CompanyMonth } from "./company";
import { addMonths, currentMonth, fmt0, monthLabel, monthOf } from "./months";
import type { AppState, Bill, Goal, MonthKey, Transaction } from "./types";

export function spendingByCategory(txs: Transaction[], month: MonthKey): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of txs) if (t.amount < 0 && monthOf(t.date) === month) out[t.category] = (out[t.category] ?? 0) - t.amount;
  return out;
}

export interface MonthTotals {
  month: MonthKey;
  receitas: number;
  despesas: number;
}

export function monthlyTotals(txs: Transaction[], months: MonthKey[]): MonthTotals[] {
  return months.map((month) => {
    let receitas = 0;
    let despesas = 0;
    for (const t of txs) {
      if (monthOf(t.date) !== month) continue;
      if (t.amount >= 0) receitas += t.amount;
      else despesas -= t.amount;
    }
    return { month, receitas, despesas };
  });
}

/** Meses (até `max`) com lançamentos, terminando antes de `before`. */
export function historyMonths(txs: Transaction[], before: MonthKey, max = 6): MonthKey[] {
  const set = new Set(txs.map((t) => monthOf(t.date)).filter((m) => m < before));
  return [...set].sort().slice(-max);
}

export interface CategoryForecast {
  category: string;
  previsto: number;
  media: number;
  tendencia: number; // variação mensal estimada (R$)
}

/**
 * Previsão de gastos do próximo mês por categoria: média ponderada dos últimos meses
 * (mais peso para os recentes) somada à tendência linear. Base da previsão local;
 * a IA recebe esses números como ponto de partida.
 */
export function forecastSpending(txs: Transaction[], target: MonthKey): CategoryForecast[] {
  const months = historyMonths(txs, target, 4);
  if (months.length === 0) return [];
  const perMonth = months.map((m) => spendingByCategory(txs, m));
  const cats = new Set(perMonth.flatMap((p) => Object.keys(p)));
  const out: CategoryForecast[] = [];
  for (const category of cats) {
    const ys = perMonth.map((p) => p[category] ?? 0);
    const n = ys.length;
    const weights = ys.map((_, i) => i + 1);
    const wsum = weights.reduce((a, b) => a + b, 0);
    const media = ys.reduce((a, y, i) => a + y * weights[i], 0) / wsum;
    let slope = 0;
    if (n >= 2) {
      const xm = (n - 1) / 2;
      const ym = ys.reduce((a, b) => a + b, 0) / n;
      const num = ys.reduce((a, y, i) => a + (i - xm) * (y - ym), 0);
      const den = ys.reduce((a, _, i) => a + (i - xm) ** 2, 0);
      slope = num / den;
    }
    out.push({ category, media, tendencia: slope, previsto: Math.max(0, media + slope * 0.5) });
  }
  return out.sort((a, b) => b.previsto - a.previsto);
}

export interface BillAlert {
  bill: Bill;
  dueDate: Date;
  daysLeft: number;
  status: "atrasada" | "vence-hoje" | "proxima" | "ok" | "paga";
}

export function billAlerts(bills: Bill[], now = new Date()): BillAlert[] {
  const month = currentMonth(now);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return bills
    .map((bill) => {
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const dueDate = new Date(now.getFullYear(), now.getMonth(), Math.min(bill.dueDay, lastDay));
      const daysLeft = Math.round((dueDate.getTime() - today.getTime()) / 86400000);
      const status: BillAlert["status"] = bill.paid.includes(month)
        ? "paga"
        : daysLeft < 0
          ? "atrasada"
          : daysLeft === 0
            ? "vence-hoje"
            : daysLeft <= 5
              ? "proxima"
              : "ok";
      return { bill, dueDate, daysLeft, status };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

export function goalMonthly(goal: Goal, from: MonthKey): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = goal.deadline.split("-").map(Number);
  const months = Math.max(1, (ty - fy) * 12 + (tm - fm));
  return Math.max(0, (goal.target - goal.saved) / months);
}

export interface Insight {
  titulo: string;
  detalhe: string;
  prioridade: "alta" | "media" | "baixa";
  impactoMensal?: number;
}

export interface Snapshot {
  month: MonthKey;
  flow: MonthResult[];
  company: CompanyMonth[];
  history: MonthTotals[];
  forecast: CategoryForecast[];
  planned: Record<string, number>;
  actual: Record<string, number>;
  alerts: BillAlert[];
}

export function snapshot(state: AppState, now = new Date()): Snapshot {
  const month = currentMonth(now);
  const company = computeCompany(state.settings, state.company);
  // Com a empresa desligada, nada vem dela para o pessoal.
  const retiradas = companyEnabled(state.company) ? Object.fromEntries(company.map((c) => [c.month, c.retiradas])) : {};
  const flow = computeCashflow(state.settings, state.lines, state.investments, retiradas);
  const histMonths = historyMonths(state.transactions, addMonths(month, 1), 6);
  return {
    month,
    flow,
    company,
    history: monthlyTotals(state.transactions, histMonths),
    forecast: forecastSpending(state.transactions, addMonths(month, 1)),
    planned: plannedByCategory(state.lines, month),
    actual: spendingByCategory(state.transactions, month),
    alerts: billAlerts(state.bills, now),
  };
}

/** Recomendações calculadas no próprio navegador — usadas quando a IA não está configurada e como base para ela. */
export function localInsights(state: AppState, snap: Snapshot): Insight[] {
  const out: Insight[] = [];
  const { flow, forecast, planned, history } = snap;

  // 1. Categorias com gasto acelerando.
  for (const f of forecast.slice(0, 6)) {
    if (f.media > 300 && f.tendencia / f.media > 0.08) {
      out.push({
        titulo: `${f.category} em alta`,
        detalhe: `Os gastos com ${f.category} sobem cerca de ${fmt0(f.tendencia)} por mês. Previsão para o próximo mês: ${fmt0(f.previsto)}. Defina um teto e acompanhe semanalmente.`,
        prioridade: f.tendencia / f.media > 0.15 ? "alta" : "media",
        impactoMensal: f.tendencia,
      });
    }
  }

  // 2. Previsão acima do orçamento (coluna Base).
  for (const f of forecast) {
    const p = planned[f.category];
    if (p && f.previsto > p * 1.1) {
      out.push({
        titulo: `${f.category}: previsão acima do orçamento`,
        detalhe: `Previsto ${fmt0(f.previsto)} contra ${fmt0(p)} de orçamento na Base (${Math.round((f.previsto / p - 1) * 100)}% acima).`,
        prioridade: "media",
        impactoMensal: f.previsto - p,
      });
    }
  }

  // 3. Meses em que será preciso resgatar dos investimentos.
  const deficits = flow.filter((m) => m.saldo1 < 0);
  if (deficits.length) {
    const worst = deficits.reduce((a, b) => (a.saldo1 < b.saldo1 ? a : b));
    out.push({
      titulo: `Resgate necessário em ${deficits.length} ${deficits.length === 1 ? "mês" : "meses"}`,
      detalhe: `O pior é ${monthLabel(worst.month)}, com resgate de ${fmt0(-worst.saldo1)}. Mantenha esse valor em aplicação de liquidez diária ou antecipe despesas sazonais (IPVA, IPTU, seguros).`,
      prioridade: "alta",
    });
  }

  // 4. Taxa de poupança.
  if (history.length) {
    const r = history.reduce((a, h) => a + h.receitas, 0);
    const d = history.reduce((a, h) => a + h.despesas, 0);
    if (r > 0) {
      const taxa = (r - d) / r;
      out.push({
        titulo: `Taxa de poupança: ${Math.round(taxa * 100)}%`,
        detalhe:
          taxa < 0.2
            ? `Abaixo dos 20% recomendados. Cortar 10% dos gastos variáveis liberaria cerca de ${fmt0((d / history.length) * 0.1)} por mês.`
            : `Acima dos 20% recomendados. Direcione o excedente para as metas com prazo mais curto.`,
        prioridade: taxa < 0.1 ? "alta" : taxa < 0.2 ? "media" : "baixa",
      });
    }
  }

  // 5. Metas: o excedente médio cobre os aportes necessários?
  const surplus = flow.slice(0, 3).reduce((a, m) => a + m.saldo1, 0) / Math.max(1, Math.min(3, flow.length));
  const needed = state.goals.reduce((a, g) => a + goalMonthly(g, snap.month), 0);
  if (state.goals.length) {
    out.push({
      titulo: needed > surplus ? "Metas exigem mais do que sobra" : "Metas cabem no orçamento",
      detalhe: `Suas metas pedem ${fmt0(needed)}/mês e o excedente projetado é ${fmt0(surplus)}/mês.${needed > surplus ? " Revise prazos ou priorize uma meta por vez." : ""}`,
      prioridade: needed > surplus ? "alta" : "baixa",
    });
  }

  // 6. Reserva de emergência.
  const despesaMensal = flow.length ? -flow[0].pessoal : 0;
  const reserva = state.investments.filter((i) => i.sweepTarget).reduce((a, i) => a + i.balance, 0);
  if (despesaMensal > 0) {
    const meses = reserva / despesaMensal;
    out.push({
      titulo: `Reserva de liquidez cobre ${meses.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} meses`,
      detalhe: meses < 6 ? `O ideal é 6 meses de despesas (${fmt0(despesaMensal * 6)}).` : "Reserva adequada; o excedente pode buscar mais rentabilidade.",
      prioridade: meses < 3 ? "alta" : meses < 6 ? "media" : "baixa",
    });
  }

  const rank = { alta: 0, media: 1, baixa: 2 };
  return out.sort((a, b) => rank[a.prioridade] - rank[b.prioridade]);
}

/** Resumo enviado à IA: só agregados, sem descrições de lançamentos individuais. */
export function aiPayload(state: AppState, snap: Snapshot) {
  return {
    mesAtual: snap.month,
    fluxoProjetado: snap.flow.map((m) => ({
      mes: m.month,
      saldoInicial: Math.round(m.saldoInicial),
      despesasPessoais: Math.round(m.pessoal),
      saldo1: Math.round(m.saldo1),
      renda: Math.round(m.renda),
      retiradasDaEmpresa: Math.round(m.retiradas),
      saldoFinal: Math.round(m.saldoFinal),
      totalInvestido: Math.round(m.totalInvestido),
      previdencia: Math.round(m.previdencia),
    })),
    empresa: (companyEnabled(state.company) ? snap.company : []).map((c) => ({
      mes: c.month,
      faturamento: Math.round(c.faturamento),
      despesas: Math.round(c.despesas),
      retiradas: Math.round(c.retiradas),
      saldoCaixaPJ: Math.round(c.saldoFinal),
    })),
    historicoMensal: snap.history.map((h) => ({ mes: h.month, receitas: Math.round(h.receitas), despesas: Math.round(h.despesas) })),
    gastosPorCategoriaUltimosMeses: historyMonths(state.transactions, addMonths(snap.month, 1), 4).map((m) => ({
      mes: m,
      categorias: Object.fromEntries(Object.entries(spendingByCategory(state.transactions, m)).map(([k, v]) => [k, Math.round(v)])),
    })),
    orcamentoMensalBase: Object.fromEntries(Object.entries(snap.planned).map(([k, v]) => [k, Math.round(v)])),
    previsaoLocal: snap.forecast.map((f) => ({ categoria: f.category, previsto: Math.round(f.previsto), tendenciaMensal: Math.round(f.tendencia) })),
    metas: state.goals.map((g) => ({ nome: g.name, alvo: g.target, guardado: g.saved, prazo: g.deadline, aporteMensalNecessario: Math.round(goalMonthly(g, snap.month)) })),
    contasAVencer: snap.alerts.filter((a) => a.status !== "paga").map((a) => ({ nome: a.bill.name, valor: a.bill.amount, diasParaVencer: a.daysLeft })),
    investimentos: state.investments.map((i) => ({ nome: i.name, saldo: Math.round(i.balance), rendimentoMensal: i.monthlyRate, tipo: i.kind })),
  };
}

export type AiPayload = ReturnType<typeof aiPayload>;
