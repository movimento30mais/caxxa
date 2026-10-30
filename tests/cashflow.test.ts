import { describe, expect, it } from "vitest";
import { computeCashflow } from "../src/lib/cashflow";
import { forecastSpending, billAlerts, goalMonthly } from "../src/lib/analytics";
import { parseAmount } from "../src/lib/parse";
import type { FlowLine, Investment } from "../src/lib/types";

const line = (name: string, group: FlowLine["group"], values: Record<string, number>): FlowLine => ({ id: name, name, group, category: "Diversos", values });

describe("computeCashflow", () => {
  const settings = { startMonth: "2026-11", months: 3, openingBalance: 1000, sweep: true };
  const lines = [
    line("Cartão", "pessoal", { "2026-11": -5000, "2026-12": -2000, "2027-01": -2000 }),
    line("Salário", "renda", { "2026-11": 10000, "2026-12": 10000, "2027-01": 10000 }),
    line("Impostos", "empresa", { "2026-11": -1000, "2026-12": -1000, "2027-01": -1000 }),
    line("13º", "renda", { "2026-12": 5000 }),
  ];
  const inv: Investment[] = [
    { id: "a", name: "Reserva", balance: 10000, monthlyRate: 0.01, sweepTarget: true, kind: "investimento" },
    { id: "p", name: "Previdência", balance: 5000, monthlyRate: 0, sweepTarget: false, kind: "previdencia" },
  ];

  it("segue a lógica da planilha: Saldo 1, resgate e saldo final encadeados", () => {
    const [nov, dez, jan] = computeCashflow(settings, lines, inv);
    expect(nov.saldo1).toBe(-4000); // 1000 − 5000
    expect(nov.resgate).toBe(4000);
    expect(nov.saldoFinal).toBe(9000); // 0 + 10000 − 1000
    expect(dez.saldoInicial).toBe(9000);
    expect(dez.saldo1).toBe(7000);
    expect(dez.saldoFinal).toBe(14000);
    expect(jan.saldo1).toBe(12000);
  });

  it("aplica rendimento e move o Saldo 1 para a conta de resgate", () => {
    const [nov, dez] = computeCashflow(settings, lines, inv);
    expect(nov.investimentos.a).toBeCloseTo(10000 * 1.01 - 4000);
    expect(dez.investimentos.a).toBeCloseTo((10000 * 1.01 - 4000) * 1.01 + 7000);
    expect(nov.previdencia).toBe(5000);
    expect(nov.totalInvestido).toBeCloseTo(nov.investimentos.a);
  });

  it("sem resgate automático o saldo acumula na conta", () => {
    const [nov, dez] = computeCashflow({ ...settings, sweep: false }, lines, inv);
    expect(nov.resgate).toBe(0);
    expect(nov.saldoFinal).toBe(-4000 + 9000);
    expect(dez.saldoInicial).toBe(5000);
  });
});

describe("parseAmount", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["-2000", -2000],
    ["=-2337,5-780", -3117.5],
    ["-400*4", -1600],
    ["", 0],
  ])("%s → %s", (raw, v) => expect(parseAmount(raw)).toBe(v));
  it("rejeita texto arbitrário", () => {
    expect(parseAmount("alert(1)")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("previsões e alertas", () => {
  it("projeta tendência de alta", () => {
    const tx = (date: string, amount: number) => ({ id: date, date, description: "x", amount, category: "Alimentação", account: "c", source: "manual" as const });
    const f = forecastSpending([tx("2026-07-10", -1000), tx("2026-08-10", -1200), tx("2026-09-10", -1400)], "2026-10");
    expect(f[0].tendencia).toBeCloseTo(200);
    expect(f[0].previsto).toBeGreaterThan(1300);
  });

  it("classifica vencimentos", () => {
    const now = new Date(2026, 9, 10);
    const bills = [
      { id: "a", name: "A", amount: 1, dueDay: 5, category: "x", paid: [] },
      { id: "b", name: "B", amount: 1, dueDay: 10, category: "x", paid: [] },
      { id: "c", name: "C", amount: 1, dueDay: 13, category: "x", paid: [] },
      { id: "d", name: "D", amount: 1, dueDay: 28, category: "x", paid: ["2026-10"] },
    ];
    expect(billAlerts(bills, now).map((a) => a.status)).toEqual(["atrasada", "vence-hoje", "proxima", "paga"]);
  });

  it("calcula aporte mensal da meta", () => {
    expect(goalMonthly({ id: "g", name: "g", target: 12000, saved: 0, deadline: "2027-10" }, "2026-10")).toBe(1000);
  });
});
