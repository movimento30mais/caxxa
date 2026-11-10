import { monthRange } from "./months";
import type { CashflowSettings, CompanyLine, CompanyState, MonthKey } from "./types";

export interface CompanyMonth {
  month: MonthKey;
  saldoInicial: number;
  /** Despesas da empresa já pagas no mês. */
  pagas: number;
  /** Caixa da PJ agora: saldo inicial − despesas já pagas. */
  caixaAgora: number;
  faturamento: number;
  /** Soma das despesas (negativa). */
  despesas: number;
  /** Faturamento + despesas. */
  resultado: number;
  /** Total retirado para a pessoa física (positivo) — entra como receita no fluxo pessoal. */
  retiradas: number;
  saldoFinal: number;
  /** Valor efetivo de cada linha no mês (inclui despesas em % e o lucro automático), por id. */
  values: Record<string, number>;
}

/** Empresa ligada? Estados antigos (sem o campo) são de quem já usava a empresa. */
export const companyEnabled = (company: CompanyState) => company.enabled !== false;

/** Valor de uma linha num mês, dado o faturamento do mês (para despesas em %). */
function lineValue(l: CompanyLine, month: MonthKey, faturamento: number): number {
  if (l.group === "despesa" && l.pctFaturamento !== undefined) return -Math.round(faturamento * l.pctFaturamento * 100) / 100;
  return l.values[month] ?? 0;
}

/**
 * Fluxo de caixa da empresa:
 *   Resultado   = Faturamento − Despesas
 *   Retiradas   = pró-labore + lucro (a linha "auto" distribui o que sobra do resultado)
 *   Saldo final = Saldo inicial + Resultado − Retiradas  → próximo Saldo inicial
 */
export function computeCompany(settings: CashflowSettings, company: CompanyState, pagasPorMes: Record<MonthKey, number> = {}): CompanyMonth[] {
  let saldoInicial = company.openingBalance;
  return monthRange(settings.startMonth, settings.months).map((month) => {
    const values: Record<string, number> = {};
    let faturamento = 0;
    for (const l of company.lines) if (l.group === "faturamento") faturamento += values[l.id] = lineValue(l, month, 0);
    let despesas = 0;
    for (const l of company.lines) if (l.group === "despesa") despesas += values[l.id] = lineValue(l, month, faturamento);
    const resultado = faturamento + despesas;
    let retiradas = 0;
    for (const l of company.lines) if (l.group === "retirada" && !l.auto) retiradas += values[l.id] = lineValue(l, month, 0);
    const auto = company.lines.find((l) => l.group === "retirada" && l.auto);
    if (auto) retiradas += values[auto.id] = Math.max(0, Math.round((resultado - retiradas) * 100) / 100);
    const saldoFinal = saldoInicial + resultado - retiradas;
    const pagas = pagasPorMes[month] ?? 0;
    const out: CompanyMonth = { month, saldoInicial, pagas, caixaAgora: saldoInicial - pagas, faturamento, despesas, resultado, retiradas, saldoFinal, values };
    saldoInicial = saldoFinal;
    return out;
  });
}

/** Orçamento mensal (Base) por linha da empresa, resolvendo % do faturamento e o lucro automático. */
export function companyBase(company: CompanyState) {
  const perLine: Record<string, number> = {};
  let faturamento = 0;
  for (const l of company.lines) if (l.group === "faturamento") faturamento += perLine[l.id] = l.base ?? 0;
  let despesas = 0;
  for (const l of company.lines)
    if (l.group === "despesa") despesas += perLine[l.id] = l.pctFaturamento !== undefined ? -Math.round(faturamento * l.pctFaturamento * 100) / 100 : (l.base ?? 0);
  const resultado = faturamento + despesas;
  let retiradas = 0;
  for (const l of company.lines) if (l.group === "retirada" && !l.auto) retiradas += perLine[l.id] = l.base ?? 0;
  const auto = company.lines.find((l) => l.group === "retirada" && l.auto);
  if (auto) retiradas += perLine[auto.id] = Math.max(0, resultado - retiradas);
  return { faturamento, despesas, resultado, retiradas, perLine };
}
