import { describe, expect, it } from "vitest";
import { computeCashflow } from "../src/lib/cashflow";
import { companyBase, computeCompany } from "../src/lib/company";
import { splitCompany, type LegacyLine } from "../src/lib/migrate";
import { forecastSpending, billAlerts, goalMonthly } from "../src/lib/analytics";
import { parseAmount } from "../src/lib/parse";
import type { FlowLine, Investment } from "../src/lib/types";

const line = (name: string, group: FlowLine["group"], values: Record<string, number>): FlowLine => ({ id: name, name, group, category: "Diversos", values });

describe("computeCashflow", () => {
  const settings = { startMonth: "2026-11", months: 3, openingBalance: 1000, sweep: true };
  const lines = [
    line("Cartão", "pessoal", { "2026-11": -5000, "2026-12": -2000, "2027-01": -2000 }),
    line("13º", "renda", { "2026-12": 5000 }),
  ];
  // Retiradas da empresa (pró-labore + lucro) que entram como receita.
  const retiradas = { "2026-11": 9000, "2026-12": 9000, "2027-01": 9000 };
  const inv: Investment[] = [
    { id: "a", name: "Reserva", balance: 10000, monthlyRate: 0.01, sweepTarget: true, kind: "investimento" },
    { id: "p", name: "Previdência", balance: 5000, monthlyRate: 0, sweepTarget: false, kind: "previdencia" },
  ];

  it("segue a lógica da planilha: Saldo 1, resgate e saldo final encadeados", () => {
    const [nov, dez, jan] = computeCashflow(settings, lines, inv, retiradas);
    expect(nov.saldo1).toBe(-4000); // 1000 − 5000
    expect(nov.resgate).toBe(4000);
    expect(nov.saldoFinal).toBe(9000); // 0 + retiradas da empresa
    expect(nov.retiradas).toBe(9000);
    expect(dez.saldoInicial).toBe(9000);
    expect(dez.saldo1).toBe(7000);
    expect(dez.saldoFinal).toBe(14000);
    expect(jan.saldo1).toBe(12000);
  });

  it("aplica rendimento e move o Saldo 1 para a conta de resgate", () => {
    const [nov, dez] = computeCashflow(settings, lines, inv, retiradas);
    expect(nov.investimentos.a).toBeCloseTo(10000 * 1.01 - 4000);
    expect(dez.investimentos.a).toBeCloseTo((10000 * 1.01 - 4000) * 1.01 + 7000);
    expect(nov.previdencia).toBe(5000);
    expect(nov.totalInvestido).toBeCloseTo(nov.investimentos.a);
  });

  it("sem resgate automático o saldo acumula na conta", () => {
    const [nov, dez] = computeCashflow({ ...settings, sweep: false }, lines, inv, retiradas);
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

describe("fluxo da empresa", () => {
  const settings = { startMonth: "2026-11", months: 2, openingBalance: 0, sweep: true };
  const company = {
    name: "PJ",
    openingBalance: 5000,
    lines: [
      { id: "f", name: "Faturamento", category: "Renda", group: "faturamento" as const, values: { "2026-11": 40000, "2026-12": 30000 }, base: 40000 },
      { id: "s", name: "Simples", category: "Impostos", group: "despesa" as const, values: {}, pctFaturamento: 0.06 },
      { id: "c", name: "Contabilidade", category: "Impostos", group: "despesa" as const, values: { "2026-11": -400, "2026-12": -400 }, base: -400 },
      { id: "p", name: "Pró-labore", category: "Renda", group: "retirada" as const, values: { "2026-11": 2000, "2026-12": 2000 }, base: 2000 },
      { id: "l", name: "Lucro", category: "Renda", group: "retirada" as const, values: {}, auto: true },
    ],
  };

  it("calcula % do faturamento e distribui o lucro automaticamente", () => {
    const [nov, dez] = computeCompany(settings, company);
    expect(nov.values.s).toBe(-2400);
    expect(nov.resultado).toBe(40000 - 2400 - 400);
    expect(nov.values.l).toBe(nov.resultado - 2000);
    expect(nov.retiradas).toBe(nov.resultado);
    expect(nov.saldoFinal).toBe(5000);
    expect(dez.values.s).toBe(-1800);
    expect(dez.saldoInicial).toBe(5000);
  });

  it("sem lucro automático o resultado não retirado fica no caixa da PJ", () => {
    const manual = { ...company, lines: company.lines.filter((l) => l.id !== "l") };
    const [nov] = computeCompany(settings, manual);
    expect(nov.retiradas).toBe(2000);
    expect(nov.saldoFinal).toBe(5000 + 37200 - 2000);
  });

  it("orçamento (Base) resolve % e lucro automático", () => {
    const b = companyBase(company);
    expect(b.perLine.s).toBe(-2400);
    expect(b.perLine.l).toBe(40000 - 2400 - 400 - 2000);
    expect(b.retiradas).toBe(37200);
  });

  it("retiradas entram como receita no fluxo pessoal", () => {
    const c = computeCompany(settings, company);
    const [nov] = computeCashflow(settings, [], [], Object.fromEntries(c.map((m) => [m.month, m.retiradas])));
    expect(nov.retiradas).toBe(37200);
    expect(nov.saldoFinal).toBe(37200);
  });
});

describe("migração do formato antigo", () => {
  it("move Salário e despesas PJ para a empresa sem mudar o saldo pessoal", () => {
    const settings = { startMonth: "2026-11", months: 1, openingBalance: 1000, sweep: true };
    const legacy: LegacyLine[] = [
      { id: "a", name: "Cartão", category: "Cartões", group: "pessoal", values: { "2026-11": -3000 } },
      { id: "b", name: "Salário", category: "Renda", group: "renda", values: { "2026-11": 39595.57 }, base: 39215.59 },
      { id: "c", name: "Impostos PJ", category: "Impostos", group: "empresa", values: { "2026-11": -3715.2 } },
      { id: "d", name: "INSS", category: "Impostos", group: "empresa", values: { "2026-11": -178.31 } },
      { id: "e", name: "13º salário", category: "Renda", group: "renda", values: { "2026-11": 100 } },
    ];
    const { lines, company } = splitCompany(legacy);
    expect(lines.map((l) => l.name)).toEqual(["Cartão", "13º salário"]);
    expect(company.lines.map((l) => [l.name, l.group])).toEqual([
      ["Faturamento", "faturamento"],
      ["Impostos PJ", "despesa"],
      ["INSS", "despesa"],
      ["Pró-labore", "retirada"],
      ["Lucro distribuído", "retirada"],
    ]);
    const c = computeCompany(settings, company);
    const [nov] = computeCashflow(settings, lines, [], { [c[0].month]: c[0].retiradas });
    // Antes: Saldo 2 (0) + Salário + despesas PJ + 13º
    expect(nov.saldoFinal).toBeCloseTo(39595.57 - 3715.2 - 178.31 + 100, 2);
  });
});

describe("empresa opcional e exemplos de novos usuários", () => {
  it("novo usuário começa como CLT: empresa desligada, salário no fluxo pessoal", async () => {
    const { demoState } = await import("../src/lib/seed");
    const { snapshot } = await import("../src/lib/analytics");
    const st = demoState(new Date(2026, 9, 15));
    expect(st.onboarded).toBe(false);
    expect(st.company.enabled).toBe(false);
    expect(st.lines.filter((l) => l.group === "pessoal").length).toBeLessThanOrEqual(6);
    const snap = snapshot(st, new Date(2026, 9, 15));
    // Nada vem da empresa desligada; a receita é o salário lançado no pessoal.
    expect(snap.flow.every((m) => m.retiradas === 0)).toBe(true);
    expect(snap.flow[0].renda).toBe(6500);
    expect(snap.flow[0].saldo1).toBe(6500 - 4850);
  });

  it("ligando a empresa, as retiradas voltam a entrar no pessoal", async () => {
    const { demoState } = await import("../src/lib/seed");
    const { snapshot } = await import("../src/lib/analytics");
    const st = demoState(new Date(2026, 9, 15));
    const snap = snapshot({ ...st, company: { ...st.company, enabled: true } }, new Date(2026, 9, 15));
    // 8.000 − 6% − 300 = 7.220 retirados (pró-labore 1.500 + lucro automático 5.720)
    expect(snap.flow[0].retiradas).toBe(7220);
  });

  it("estados antigos sem o campo continuam com a empresa ligada", async () => {
    const { companyEnabled } = await import("../src/lib/company");
    expect(companyEnabled({ name: "x", openingBalance: 0, lines: [] })).toBe(true);
    expect(companyEnabled({ name: "x", openingBalance: 0, lines: [], enabled: false })).toBe(false);
  });
});
