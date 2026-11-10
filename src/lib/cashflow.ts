import { monthRange } from "./months";
import type { CashflowSettings, FlowLine, Investment, LineGroup, MonthKey } from "./types";

export interface MonthResult {
  month: MonthKey;
  saldoInicial: number;
  /** Despesas do mês já pagas (saíram da conta). */
  pagas: number;
  /**
   * Já resgatado do investimento para cobrir as contas pagas (com o resgate automático): o que as contas pagas
   * passaram do saldo inicial. Faz parte do resgate previsto para o mês (não é um resgate a mais).
   */
  resgatado: number;
  /** Saldo em conta agora: saldo inicial − despesas já pagas + já resgatado. */
  saldoEmConta: number;
  /** Despesas do mês ainda a pagar (negativo). */
  pendente: number;
  pessoal: number;
  /** Saldo Inicial + despesas pessoais. */
  saldo1: number;
  /** Aplicação (negativo) ou resgate (positivo) que zera o Saldo 1. */
  resgate: number;
  saldo2: number;
  renda: number;
  /** Retiradas da empresa (pró-labore + lucro) recebidas no mês. */
  retiradas: number;
  extra: number;
  saldoFinal: number;
  /** Saldo de cada investimento ao fim do mês, por id. */
  investimentos: Record<string, number>;
  totalInvestido: number;
  previdencia: number;
  patrimonio: number;
}

export function sumGroup(lines: FlowLine[], group: LineGroup, month: MonthKey): number {
  return lines.reduce((acc, l) => (l.group === group ? acc + (l.values[month] ?? 0) : acc), 0);
}

/**
 * Reproduz a aba "Fluxo de Caixa" da planilha:
 *   Saldo 1     = Saldo Inicial + Σ despesas pessoais
 *   Resgate     = −Saldo 1 (quando o sweep está ligado — a sobra vai para o investimento, o déficit sai dele)
 *   Saldo final = Saldo 2 + receitas pessoais + retiradas da empresa + extras
 *   Próximo Saldo Inicial = Saldo final
 * Investimentos rendem a taxa mensal e a conta "sweepTarget" recebe o Saldo 1.
 */
export function computeCashflow(
  settings: CashflowSettings,
  lines: FlowLine[],
  investments: Investment[],
  /** Retiradas da empresa por mês (de computeCompany), que entram como receita. */
  retiradasPorMes: Record<MonthKey, number> = {},
  /** Despesas já pagas por mês (de paidTotals): saem do saldo em conta, sem mudar o Saldo 1. */
  pagasPorMes: Record<MonthKey, number> = {},
): MonthResult[] {
  const months = monthRange(settings.startMonth, settings.months);
  const balances: Record<string, number> = Object.fromEntries(investments.map((i) => [i.id, i.balance]));
  const target = investments.find((i) => i.sweepTarget && i.kind === "investimento");
  let saldoInicial = settings.openingBalance;

  return months.map((month) => {
    const pessoal = sumGroup(lines, "pessoal", month);
    const saldo1 = saldoInicial + pessoal;
    const resgate = settings.sweep ? -saldo1 : 0;
    const saldo2 = saldo1 + resgate;
    const renda = sumGroup(lines, "renda", month);
    const retiradas = retiradasPorMes[month] ?? 0;
    const extra = sumGroup(lines, "extra", month);
    const saldoFinal = saldo2 + renda + retiradas + extra;

    for (const inv of investments) balances[inv.id] *= 1 + inv.monthlyRate;
    if (target) balances[target.id] -= resgate;

    const totalInvestido = investments
      .filter((i) => i.kind === "investimento")
      .reduce((a, i) => a + balances[i.id], 0);
    const previdencia = investments
      .filter((i) => i.kind === "previdencia")
      .reduce((a, i) => a + balances[i.id], 0);

    const pagas = pagasPorMes[month] ?? 0;
    // Com o resgate automático, o que faltar na conta para pagar as contas sai do investimento na hora.
    const resgatado = settings.sweep ? Math.max(0, pagas - saldoInicial) : 0;
    const result: MonthResult = {
      month,
      saldoInicial,
      pagas,
      resgatado,
      saldoEmConta: saldoInicial - pagas + resgatado,
      pendente: pessoal + pagas,
      pessoal,
      saldo1,
      resgate,
      saldo2,
      renda,
      retiradas,
      extra,
      saldoFinal,
      investimentos: { ...balances },
      totalInvestido,
      previdencia,
      patrimonio: saldoFinal + totalInvestido + previdencia,
    };
    saldoInicial = saldoFinal;
    return result;
  });
}

/** Orçamento da linha no mês: a coluna Base quando preenchida, senão o valor projetado do mês. */
export function budgetOf(line: FlowLine, month: MonthKey): number {
  return line.base ?? line.values[month] ?? 0;
}

/** Orçamento por categoria (somente saídas) em um mês. */
export function plannedByCategory(lines: FlowLine[], month: MonthKey): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) {
    const v = budgetOf(l, month);
    if (v < 0 && l.group !== "renda") out[l.category] = (out[l.category] ?? 0) + -v;
  }
  return out;
}
