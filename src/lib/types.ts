/** Mês no formato "AAAA-MM". */
export type MonthKey = string;

/**
 * Grupos de linhas do fluxo de caixa, espelhando os blocos da planilha:
 * - pessoal: despesas do mês (Cartões, Condomínio, Carro...) — somadas ao Saldo Inicial para formar o "Saldo 1"
 * - renda:   entradas que chegam no fim do mês (Salário, Férias, 13º)
 * - empresa: despesas da PJ (Impostos, INSS, Contabilidade)
 * - extra:   outros lançamentos após o resgate (ex.: "AP novo")
 */
export type LineGroup = "pessoal" | "renda" | "empresa" | "extra";

export interface FlowLine {
  id: string;
  name: string;
  category: string;
  group: LineGroup;
  /** Valor com sinal (negativo = saída) por mês. */
  values: Record<MonthKey, number>;
  /** Coluna "Base" da planilha: orçamento mensal da linha, com sinal. */
  base?: number;
}

export interface Investment {
  id: string;
  name: string;
  /** Saldo no início do primeiro mês do fluxo. */
  balance: number;
  /** Rendimento mensal (0.005 = 0,5% a.m.). */
  monthlyRate: number;
  /** Conta que recebe as aplicações/resgates do "Saldo 1". */
  sweepTarget: boolean;
  /** Previdência fica fora do total "TT INVESTIMENTO", como na planilha. */
  kind: "investimento" | "previdencia";
}

export interface CashflowSettings {
  startMonth: MonthKey;
  months: number;
  openingBalance: number;
  /** "Resgate": zera a conta corrente todo mês aplicando/resgatando o Saldo 1 nos investimentos. */
  sweep: boolean;
}

export interface Transaction {
  id: string;
  date: string; // AAAA-MM-DD
  description: string;
  amount: number; // negativo = despesa
  category: string;
  account: string;
  source: "manual" | "openfinance";
  externalId?: string;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
  deadline: string; // AAAA-MM
  icon?: string;
}

export interface Bill {
  id: string;
  name: string;
  amount: number;
  dueDay: number;
  category: string;
  /** Meses (AAAA-MM) já pagos. */
  paid: MonthKey[];
}

export interface BankConnection {
  id: string;
  institution: string;
  itemId: string;
  mode: "pluggy" | "sandbox";
  lastSync?: string;
}

export interface AppState {
  version: 1;
  settings: CashflowSettings;
  lines: FlowLine[];
  investments: Investment[];
  transactions: Transaction[];
  goals: Goal[];
  bills: Bill[];
  connections: BankConnection[];
}
