/** Mês no formato "AAAA-MM". */
export type MonthKey = string;

/**
 * Grupos de linhas do fluxo pessoal, espelhando os blocos da planilha:
 * - pessoal: despesas do mês (Cartões, Condomínio, Carro...) — somadas ao Saldo Inicial para formar o "Saldo 1"
 * - renda:   entradas pessoais que chegam no fim do mês (13º, férias, aluguéis). As retiradas da empresa entram
 *            automaticamente, vindas do fluxo da empresa.
 * - extra:   outros lançamentos após o resgate (ex.: "AP novo")
 */
export type LineGroup = "pessoal" | "renda" | "extra";

/**
 * Grupos do fluxo da empresa:
 * - faturamento: receitas da PJ
 * - despesa:     impostos, INSS, contabilidade… (podem ser % do faturamento)
 * - retirada:    pró-labore e lucro distribuído — viram receita no fluxo pessoal
 */
export type CompanyGroup = "faturamento" | "despesa" | "retirada";

export interface FlowLine<G extends string = LineGroup> {
  id: string;
  name: string;
  category: string;
  group: G;
  /** Valor por mês. Pessoal e despesas da empresa: negativo = saída. Retiradas: valor retirado (positivo). */
  values: Record<MonthKey, number>;
  /** Coluna "Base" da planilha: orçamento mensal da linha, com o mesmo sinal dos valores. */
  base?: number;
  /** Despesa da empresa calculada como fração do faturamento do mês (0.06 = 6%). */
  pctFaturamento?: number;
  /** Retirada que distribui automaticamente o resultado do mês (faturamento − despesas − demais retiradas). */
  auto?: boolean;
}

export type CompanyLine = FlowLine<CompanyGroup>;

export interface CompanyState {
  name: string;
  /** Fluxo da empresa ligado (quem é PJ). Desligado, as receitas vêm só do fluxo pessoal (ex.: salário CLT). */
  enabled?: boolean;
  /** Saldo em caixa da PJ no início do primeiro mês. */
  openingBalance: number;
  lines: CompanyLine[];
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
  /** "patrimonio": o valor guardado vem do fluxo (investimentos + previdência, com rendimentos); senão, é lançado à mão. */
  kind?: "manual" | "patrimonio";
  /** Meta de patrimônio: soma a previdência (padrão: sim). O saldo em conta corrente não entra. */
  includePrevidencia?: boolean;
}

export interface Bill {
  id: string;
  name: string;
  amount: number;
  dueDay: number;
  category: string;
  /** Meses (AAAA-MM) já pagos. */
  paid: MonthKey[];
  /** De onde vem: cadastrada à mão, ou gerada de uma despesa do fluxo pessoal / da empresa. */
  source?: "manual" | "pessoal" | "empresa";
  lineId?: string;
  /** Valor calculado (ex.: % do faturamento) — não editável na conta. */
  computed?: boolean;
  /** Pagamentos registrados por mês. */
  payments?: Record<MonthKey, Payment>;
}

/** Pagamento de uma conta num mês. */
export interface Payment {
  /** Valor efetivamente pago. */
  amount: number;
  /** Data do pagamento (AAAA-MM-DD). */
  date: string;
  /** Valor que estava previsto no fluxo antes do pagamento (para desfazer, se o pago foi diferente). */
  planned: number;
  /** Lançamento criado em Lançamentos para este pagamento. */
  transactionId?: string;
}

/** Ajustes da conta a pagar gerada automaticamente de uma despesa do fluxo (por id da linha). */
export interface LineBill {
  dueDay: number;
  paid: MonthKey[];
  /** Nome próprio na lista de contas (senão, o nome da linha). */
  name?: string;
  /** Não é uma conta a pagar (ex.: "Lazer"): some da lista. */
  hidden?: boolean;
  /** Pagamentos registrados por mês (os meses pagos também ficam em `paid`). */
  payments?: Record<MonthKey, Payment>;
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
  company: CompanyState;
  investments: Investment[];
  transactions: Transaction[];
  goals: Goal[];
  /** Contas cadastradas à mão. */
  bills: Bill[];
  /** Ajustes das contas geradas das despesas do fluxo. */
  lineBills?: Record<string, LineBill>;
  connections: BankConnection[];
  /** false = ainda não respondeu "Como você recebe?" (CLT ou PJ). Estados antigos não têm o campo e não perguntam. */
  onboarded?: boolean;
}
