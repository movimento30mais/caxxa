import { companyEnabled, computeCompany, type CompanyMonth } from "./company";
import { uid } from "./seed";
import type { AppState, Bill, FlowLine, LineBill, MonthKey, Payment, Transaction } from "./types";

export const DEFAULT_DUE_DAY = 10;

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

export interface MonthBills {
  /** Contas do mês: as avulsas + uma por despesa do fluxo com valor no mês. */
  visible: Bill[];
  /** Despesas do fluxo marcadas como "não é conta". */
  hidden: Bill[];
}

/**
 * Contas a pagar de um mês. Cada despesa do fluxo pessoal e da empresa (quando ligada) com valor no mês
 * vira uma conta automaticamente; o valor vem sempre do fluxo, e vencimento, nome e pagamento ficam em lineBills.
 */
export function billsForMonth(state: AppState, month: MonthKey, company?: CompanyMonth[]): MonthBills {
  const visible: Bill[] = [];
  const hidden: Bill[] = [];
  const cfg = state.lineBills ?? {};
  const push = (b: Bill, lb?: LineBill) => (lb?.hidden ? hidden : visible).push(b);

  for (const l of state.lines) {
    const v = l.values[month] ?? 0;
    if (l.group !== "pessoal" || v >= 0) continue;
    const lb = cfg[l.id];
    push(
      { id: `line:${l.id}`, name: lb?.name ?? l.name, amount: -v, dueDay: lb?.dueDay ?? DEFAULT_DUE_DAY, category: l.category, paid: lb?.paid ?? [], payments: lb?.payments, source: "pessoal", lineId: l.id },
      lb,
    );
  }

  if (companyEnabled(state.company)) {
    const cm = (company ?? computeCompany(state.settings, state.company)).find((c) => c.month === month);
    for (const l of state.company.lines) {
      if (l.group !== "despesa") continue;
      const v = cm ? (cm.values[l.id] ?? 0) : (l.values[month] ?? 0);
      if (v >= 0) continue;
      const lb = cfg[l.id];
      push(
        {
          id: `line:${l.id}`,
          name: lb?.name ?? l.name,
          amount: -v,
          dueDay: lb?.dueDay ?? DEFAULT_DUE_DAY,
          category: l.category,
          paid: lb?.paid ?? [],
          payments: lb?.payments,
          source: "empresa",
          lineId: l.id,
          computed: l.pctFaturamento !== undefined,
        },
        lb,
      );
    }
  }

  for (const b of state.bills) visible.push({ ...b, source: "manual" });
  return { visible, hidden };
}

/**
 * Contas cadastradas à mão com o mesmo nome de uma despesa do fluxo viram a conta automática dessa despesa
 * (mantendo vencimento e pagamentos), para não aparecerem duplicadas.
 */
export function mergeManualDuplicates(state: AppState): AppState {
  const lines = [...state.lines.filter((l) => l.group === "pessoal"), ...state.company.lines.filter((l) => l.group === "despesa")];
  const byName = new Map(lines.map((l) => [norm(l.name), l.id]));
  const lineBills = { ...(state.lineBills ?? {}) };
  const bills = state.bills.filter((b) => {
    const id = byName.get(norm(b.name));
    if (!id || lineBills[id]) return true;
    lineBills[id] = { dueDay: b.dueDay, paid: b.paid };
    return false;
  });
  if (bills.length === state.bills.length && state.lineBills) return state;
  return { ...state, bills, lineBills };
}

/* ---------- Pagamentos ---------- */

export interface PaidTotals {
  /** Total já pago por mês das despesas do fluxo pessoal (saem do saldo em conta). */
  pessoal: Record<MonthKey, number>;
  /** Total já pago por mês das despesas da empresa (saem do caixa da PJ). */
  empresa: Record<MonthKey, number>;
  /** Valor pago por linha e mês (para marcar as linhas pagas no fluxo). */
  byLine: Record<string, Record<MonthKey, number>>;
}

/** Quanto já foi pago de cada despesa do fluxo, por mês. */
export function paidTotals(state: AppState): PaidTotals {
  const out: PaidTotals = { pessoal: {}, empresa: {}, byLine: {} };
  const cfg = state.lineBills ?? {};
  const add = (kind: "pessoal" | "empresa", l: FlowLine<string>) => {
    const lb = cfg[l.id];
    if (!lb || lb.hidden) return;
    for (const m of lb.paid) {
      // Contas marcadas antes de existir o registro do valor pago: vale o valor do fluxo.
      const amount = lb.payments?.[m]?.amount ?? -(l.values[m] ?? 0);
      if (!(amount > 0)) continue;
      out[kind][m] = (out[kind][m] ?? 0) + amount;
      (out.byLine[l.id] ??= {})[m] = amount;
    }
  };
  for (const l of state.lines) if (l.group === "pessoal") add("pessoal", l);
  if (companyEnabled(state.company)) for (const l of state.company.lines) if (l.group === "despesa") add("empresa", l);
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Data do pagamento: hoje, se for o mês atual; senão, o dia de vencimento naquele mês. */
export function paymentDate(month: MonthKey, dueDay: number, now = new Date()): string {
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (today.startsWith(month)) return today;
  const [y, m] = month.split("-").map(Number);
  return `${month}-${pad(Math.min(dueDay, new Date(y, m, 0).getDate()))}`;
}

/** Troca o valor de uma linha do fluxo num mês (despesa: valor negativo). */
const setLineValue = <T extends FlowLine<string>>(ls: T[], id: string, month: MonthKey, amount: number) =>
  ls.map((l) => (l.id === id ? { ...l, values: { ...l.values, [month]: -Math.abs(amount) } } : l));

/**
 * Paga uma conta no mês:
 * - registra o pagamento (valor e data);
 * - se o valor pago for diferente do previsto, ele substitui o previsto no fluxo (o saldo final se ajusta);
 * - contas pessoais e avulsas viram um lançamento em Lançamentos (o "realizado").
 * No fluxo, a despesa paga sai das pendentes e o saldo em conta do mês diminui.
 */
export function payBill(state: AppState, bill: Bill, month: MonthKey, amount: number, now = new Date()): AppState {
  amount = Math.round(Math.abs(amount) * 100) / 100;
  const date = paymentDate(month, bill.dueDay, now);
  let next: AppState = state;

  if (bill.lineId && !bill.computed && amount !== bill.amount) {
    next =
      bill.source === "empresa"
        ? { ...next, company: { ...next.company, lines: setLineValue(next.company.lines, bill.lineId, month, amount) } }
        : { ...next, lines: setLineValue(next.lines, bill.lineId, month, amount) };
  }

  let transactionId: string | undefined;
  if (bill.source !== "empresa") {
    const tx: Transaction = {
      id: uid("t"),
      date,
      description: bill.name,
      amount: -amount,
      category: bill.category,
      account: "Conta corrente",
      source: "manual",
      externalId: `bill:${bill.id}:${month}`,
    };
    transactionId = tx.id;
    next = { ...next, transactions: [tx, ...next.transactions].sort((a, b) => b.date.localeCompare(a.date)) };
  }

  const payment: Payment = { amount, date, planned: bill.amount, transactionId };
  if (bill.source === "manual" || !bill.lineId) {
    return {
      ...next,
      bills: next.bills.map((b) =>
        b.id === bill.id ? { ...b, paid: [...b.paid.filter((m) => m !== month), month], payments: { ...b.payments, [month]: payment } } : b,
      ),
    };
  }
  const cur = next.lineBills?.[bill.lineId] ?? { dueDay: bill.dueDay, paid: [] };
  return {
    ...next,
    lineBills: {
      ...next.lineBills,
      [bill.lineId]: { ...cur, paid: [...cur.paid.filter((m) => m !== month), month], payments: { ...cur.payments, [month]: payment } },
    },
  };
}

/** Desfaz o pagamento: volta a conta para pendente, restaura o valor previsto no fluxo e apaga o lançamento. */
export function unpayBill(state: AppState, bill: Bill, month: MonthKey): AppState {
  const payment = bill.payments?.[month];
  let next: AppState = state;

  if (payment && bill.lineId && !bill.computed && payment.amount !== payment.planned) {
    next =
      bill.source === "empresa"
        ? { ...next, company: { ...next.company, lines: setLineValue(next.company.lines, bill.lineId, month, payment.planned) } }
        : { ...next, lines: setLineValue(next.lines, bill.lineId, month, payment.planned) };
  }
  const externalId = `bill:${bill.id}:${month}`;
  next = { ...next, transactions: next.transactions.filter((t) => t.id !== payment?.transactionId && t.externalId !== externalId) };

  const drop = <T extends { paid: MonthKey[]; payments?: Record<MonthKey, Payment> }>(x: T): T => {
    const payments = { ...x.payments };
    delete payments[month];
    return { ...x, paid: x.paid.filter((m) => m !== month), payments };
  };
  if (bill.source === "manual" || !bill.lineId) return { ...next, bills: next.bills.map((b) => (b.id === bill.id ? drop(b) : b)) };
  const cur = next.lineBills?.[bill.lineId];
  return cur ? { ...next, lineBills: { ...next.lineBills, [bill.lineId]: drop(cur) } } : next;
}
