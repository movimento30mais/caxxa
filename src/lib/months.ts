import type { MonthKey } from "./types";

const NOMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function addMonths(key: MonthKey, n: number): MonthKey {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthRange(start: MonthKey, count: number): MonthKey[] {
  return Array.from({ length: count }, (_, i) => addMonths(start, i));
}

export function currentMonth(now = new Date()): MonthKey {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: MonthKey, withYear = true): string {
  const [y, m] = key.split("-").map(Number);
  return withYear ? `${NOMES[m - 1]}/${String(y).slice(2)}` : NOMES[m - 1];
}

export function monthOf(date: string): MonthKey {
  return date.slice(0, 7);
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export const fmt = (v: number) => brl.format(v);
export const fmt0 = (v: number) => brl0.format(v);
export const fmtK = (v: number) =>
  Math.abs(v) >= 1000 ? `${v < 0 ? "-" : ""}R$ ${(Math.abs(v) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : fmt0(v);
