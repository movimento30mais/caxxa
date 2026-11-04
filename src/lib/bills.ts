import { companyEnabled, computeCompany, type CompanyMonth } from "./company";
import type { AppState, Bill, LineBill, MonthKey } from "./types";

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
      { id: `line:${l.id}`, name: lb?.name ?? l.name, amount: -v, dueDay: lb?.dueDay ?? DEFAULT_DUE_DAY, category: l.category, paid: lb?.paid ?? [], source: "pessoal", lineId: l.id },
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
