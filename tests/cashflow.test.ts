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

describe("contas a pagar automáticas", () => {
  const base = async () => {
    const { demoState } = await import("../src/lib/seed");
    return demoState(new Date(2026, 10, 4));
  };

  it("gera uma conta por despesa do fluxo pessoal com valor no mês", async () => {
    const { billsForMonth } = await import("../src/lib/bills");
    const st = await base();
    const { visible, hidden } = billsForMonth(st, "2026-11");
    expect(visible.map((b) => [b.name, b.amount, b.dueDay, b.source])).toEqual([
      ["Aluguel + condomínio", 1800, 5, "pessoal"],
      ["Cartão de crédito", 1200, 10, "pessoal"],
      ["Luz + internet", 250, 20, "pessoal"],
    ]);
    // Mercado, transporte e lazer existem, mas marcados como "não é conta".
    expect(hidden.map((b) => b.name)).toEqual(["Mercado", "Transporte", "Lazer"]);
  });

  it("inclui as despesas da empresa quando ela está ligada (com o valor em % já calculado)", async () => {
    const { billsForMonth } = await import("../src/lib/bills");
    const st = await base();
    const off = billsForMonth(st, "2026-11").visible.filter((b) => b.source === "empresa");
    expect(off).toHaveLength(0);
    const on = billsForMonth({ ...st, company: { ...st.company, enabled: true } }, "2026-11").visible.filter((b) => b.source === "empresa");
    expect(on.map((b) => [b.name, b.amount, b.computed])).toEqual([
      ["Simples Nacional", 480, true],
      ["Contabilidade", 300, false],
    ]);
  });

  it("acompanha o valor do fluxo e usa nome/vencimento/pagamento editados", async () => {
    const { billsForMonth } = await import("../src/lib/bills");
    const st = await base();
    const cartao = st.lines.find((l) => l.name === "Cartão de crédito")!;
    const edited = {
      ...st,
      lines: st.lines.map((l) => (l.id === cartao.id ? { ...l, values: { ...l.values, "2026-11": -1500 } } : l)),
      lineBills: { ...st.lineBills, [cartao.id]: { dueDay: 15, paid: ["2026-11"], name: "Fatura Nubank" } },
    };
    const b = billsForMonth(edited, "2026-11").visible.find((x) => x.lineId === cartao.id)!;
    expect([b.name, b.amount, b.dueDay, b.paid]).toEqual(["Fatura Nubank", 1500, 15, ["2026-11"]]);
  });

  it("conta manual com o mesmo nome de uma despesa vira a automática (sem duplicar)", async () => {
    const { billsForMonth, mergeManualDuplicates } = await import("../src/lib/bills");
    const st = await base();
    const legacy = { ...st, lineBills: undefined, bills: [{ id: "b1", name: "Aluguel + Condomínio", amount: 1800, dueDay: 7, category: "Moradia", paid: ["2026-10"] }, { id: "b2", name: "Academia", amount: 120, dueDay: 3, category: "Lazer", paid: [] }] };
    const merged = mergeManualDuplicates(legacy);
    expect(merged.bills.map((b) => b.name)).toEqual(["Academia"]);
    const aluguel = billsForMonth(merged, "2026-11").visible.find((b) => b.name === "Aluguel + condomínio")!;
    expect([aluguel.dueDay, aluguel.paid, aluguel.source]).toEqual([7, ["2026-10"], "pessoal"]);
  });

  it("situação das contas de outro mês", async () => {
    const { billAlerts } = await import("../src/lib/analytics");
    const bill = { id: "x", name: "X", amount: 1, dueDay: 10, category: "c", paid: [] };
    const now = new Date(2026, 10, 4);
    expect(billAlerts([bill], now, "2026-10")[0].status).toBe("atrasada");
    expect(billAlerts([bill], now, "2026-12")[0].status).toBe("ok");
  });
});

describe("meta de patrimônio (do fluxo, com rendimentos)", () => {
  const settings = { startMonth: "2026-11", months: 12, openingBalance: 0, sweep: true };
  const lines = [line("Despesas", "pessoal", Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`${2026 + Math.floor((10 + i) / 12)}-${String(((10 + i) % 12) + 1).padStart(2, "0")}`, -4000]))), line("Salário", "renda", {})];
  const inv: Investment[] = [
    { id: "a", name: "CDB", balance: 10000, monthlyRate: 0.01, sweepTarget: true, kind: "investimento" },
    { id: "p", name: "Previdência", balance: 20000, monthlyRate: 0.005, sweepTarget: false, kind: "previdencia" },
  ];
  // Salário de 5.000 chega no fim do mês: a partir do 2º mês sobra 1.000 aplicado nos investimentos.
  const retiradas = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`${2026 + Math.floor((10 + i) / 12)}-${String(((10 + i) % 12) + 1).padStart(2, "0")}`, 5000]));
  const flow = computeCashflow({ ...settings, openingBalance: 4000 }, lines, inv, retiradas);
  const goal = { id: "g", name: "Patrimônio", target: 50000, saved: 0, deadline: "2028-11", kind: "patrimonio" as const };

  it("guardado = investimentos + previdência do mês atual no fluxo (sem saldo em conta)", async () => {
    const { goalProgress } = await import("../src/lib/goals");
    const p = goalProgress(goal, "2026-11", flow, settings, inv);
    expect(p.saved).toBeCloseTo(flow[0].totalInvestido + flow[0].previdencia);
    // A diferença para o "Patrimônio" do fluxo é exatamente o saldo em conta, que fica de fora.
    expect(flow[0].saldoFinal).toBeGreaterThan(0);
    expect(flow[0].patrimonio - p.saved).toBeCloseTo(flow[0].saldoFinal);
    const semPrev = goalProgress({ ...goal, includePrevidencia: false }, "2026-11", flow, settings, inv);
    expect(semPrev.saved).toBeCloseTo(flow[0].totalInvestido);
  });

  it("projeção usa o fluxo e depois juros compostos com rendimento médio e aporte médio", async () => {
    const { goalProgress } = await import("../src/lib/goals");
    const p = goalProgress(goal, "2026-11", flow, settings, inv);
    const a = p.auto!;
    // Rendimento médio ponderado pelo saldo: (10.000·1% + 20.000·0,5%) / 30.000
    expect(a.rate).toBeCloseTo((100 + 100) / 30000);
    expect(a.series[0]).toEqual({ month: "2026-11", value: p.saved });
    expect(a.series[11].value).toBeCloseTo(flow[11].totalInvestido + flow[11].previdencia);
    // Depois do horizonte: valor anterior × (1 + taxa) + aporte médio
    expect(a.series[12].value).toBeCloseTo(a.series[11].value * (1 + a.rate) + a.contribution);
    expect(a.series.at(-1)!.month).toBe("2028-11");
    expect(a.atDeadline).toBeCloseTo(a.series.at(-1)!.value);
    // Primeiro mês em que passa do alvo
    const first = a.series.find((x) => x.value >= goal.target);
    if (first) expect(a.reachMonth).toBe(first.month);
  });

  it("aporte necessário desconta o rendimento (fórmula de juros compostos)", async () => {
    const { goalProgress, monthsBetween } = await import("../src/lib/goals");
    const p = goalProgress(goal, "2026-11", flow, settings, inv);
    const r = p.auto!.rate;
    const n = monthsBetween("2026-11", goal.deadline);
    // Aplicando o aporte calculado todo mês, chega exatamente no alvo
    let v = p.saved;
    for (let i = 0; i < n; i++) v = v * (1 + r) + p.monthly;
    expect(v).toBeCloseTo(goal.target, 0);
    // E é menor que a conta simples (o que falta dividido pelos meses)
    expect(p.monthly).toBeLessThan((goal.target - p.saved) / n);
  });

  it("meta comum continua com o valor guardado à mão", async () => {
    const { goalProgress } = await import("../src/lib/goals");
    const p = goalProgress({ ...goal, kind: "manual", saved: 2000 }, "2026-11", flow, settings, inv);
    expect(p.saved).toBe(2000);
    expect(p.auto).toBeUndefined();
  });
});

describe("pagar conta: sai das pendentes do fluxo e do saldo em conta", () => {
  const now = new Date(2026, 10, 10);
  const setup = async () => {
    const { demoState } = await import("../src/lib/seed");
    const { billsForMonth } = await import("../src/lib/bills");
    const { snapshot } = await import("../src/lib/analytics");
    const st = demoState(now);
    // Começa sem nada pago, para o teste ser independente do dia.
    const clean = { ...st, lineBills: Object.fromEntries(Object.entries(st.lineBills!).map(([k, v]) => [k, { ...v, paid: [] }])) };
    const cartao = () => billsForMonth(clean, "2026-11").visible.find((b) => b.name === "Cartão de crédito")!;
    return { st: clean, cartao, snapshot, billsForMonth };
  };

  it("pagar o valor previsto: saldo em conta cai, pendentes caem, Saldo 1 e saldo final não mudam", async () => {
    const { payBill } = await import("../src/lib/bills");
    const { st, cartao, snapshot } = await setup();
    const before = snapshot(st, now).flow[0];
    const after = snapshot(payBill(st, cartao(), "2026-11", 1200, now), now).flow[0];
    expect(after.pagas).toBe(1200);
    expect(after.saldoEmConta).toBe(before.saldoInicial - 1200);
    expect(after.pendente).toBe(before.pessoal + 1200);
    expect(after.saldo1).toBe(before.saldo1);
    expect(after.saldoFinal).toBe(before.saldoFinal);
  });

  it("pagar valor diferente: o pago substitui o previsto e os saldos se ajustam", async () => {
    const { payBill } = await import("../src/lib/bills");
    const { st, cartao, snapshot } = await setup();
    const before = snapshot(st, now).flow[0];
    const paid = payBill(st, cartao(), "2026-11", 1380, now);
    const after = snapshot(paid, now).flow[0];
    // Com o resgate automático (modelo da planilha) a diferença sai da sobra do mês e, portanto, dos investimentos.
    expect(after.saldo1).toBe(before.saldo1 - 180);
    expect(after.totalInvestido).toBeCloseTo(before.totalInvestido - 180);
    // Sem o resgate automático, ela aparece direto no saldo final.
    const noSweep = (x: typeof st) => ({ ...x, settings: { ...x.settings, sweep: false } });
    expect(snapshot(noSweep(paid), now).flow[0].saldoFinal).toBe(snapshot(noSweep(st), now).flow[0].saldoFinal - 180);
    expect(paid.lines.find((l) => l.name === "Cartão de crédito")!.values["2026-11"]).toBe(-1380);
  });

  it("cria o lançamento com a data de hoje e desmarcar desfaz tudo", async () => {
    const { payBill, unpayBill } = await import("../src/lib/bills");
    const { st, cartao, snapshot, billsForMonth } = await setup();
    const paid = payBill(st, cartao(), "2026-11", 1380, now);
    const tx = paid.transactions.find((t) => t.externalId === `bill:${cartao().id}:2026-11`)!;
    expect([tx.date, tx.amount, tx.description, tx.category]).toEqual(["2026-11-10", -1380, "Cartão de crédito", "Cartões"]);
    const bill = billsForMonth(paid, "2026-11").visible.find((b) => b.name === "Cartão de crédito")!;
    expect(bill.payments!["2026-11"]).toMatchObject({ amount: 1380, planned: 1200, date: "2026-11-10" });
    const undone = unpayBill(paid, bill, "2026-11");
    expect(undone.lines.find((l) => l.name === "Cartão de crédito")!.values["2026-11"]).toBe(-1200);
    expect(undone.transactions.some((t) => t.id === tx.id)).toBe(false);
    expect(snapshot(undone, now).flow[0]).toEqual(snapshot(st, now).flow[0]);
  });

  it("pagamento de outro mês usa o dia de vencimento como data", async () => {
    const { paymentDate } = await import("../src/lib/bills");
    expect(paymentDate("2026-12", 31, now)).toBe("2026-12-31");
    expect(paymentDate("2027-02", 31, now)).toBe("2027-02-28");
    expect(paymentDate("2026-11", 5, now)).toBe("2026-11-10");
  });

  it("despesa da empresa paga sai do caixa da PJ e não vira lançamento pessoal", async () => {
    const { payBill } = await import("../src/lib/bills");
    const { st, snapshot, billsForMonth } = await setup();
    const pj = { ...st, company: { ...st.company, enabled: true } };
    const contab = billsForMonth(pj, "2026-11").visible.find((b) => b.name === "Contabilidade")!;
    const paid = payBill(pj, contab, "2026-11", 300, now);
    const c = snapshot(paid, now).company[0];
    expect([c.pagas, c.caixaAgora]).toEqual([300, c.saldoInicial - 300]);
    expect(paid.transactions.length).toBe(pj.transactions.length);
  });
});

describe("resgate do investimento ao pagar contas", () => {
  const settings = { startMonth: "2026-11", months: 2, openingBalance: 1000, sweep: true };
  const lines = [line("Aluguel", "pessoal", { "2026-11": -1800, "2026-12": -1800 }), line("Cartão", "pessoal", { "2026-11": -700, "2026-12": -700 })];
  const inv: Investment[] = [{ id: "a", name: "CDB", balance: 10000, monthlyRate: 0, sweepTarget: true, kind: "investimento" }];
  const retiradas = { "2026-11": 3000, "2026-12": 3000 };

  it("contas pagas além do saldo saem do investimento e a conta não fica negativa", () => {
    const [nov] = computeCashflow(settings, lines, inv, retiradas, { "2026-11": 1800 });
    expect(nov.resgatado).toBe(800);
    expect(nov.saldoEmConta).toBe(0);
    // Faz parte do resgate previsto para o mês: o total não muda.
    expect(nov.resgate).toBe(1500);
    expect(nov.resgatado).toBeLessThanOrEqual(nov.resgate);
    const [semPagar] = computeCashflow(settings, lines, inv, retiradas);
    expect([nov.saldo1, nov.saldoFinal, nov.investimentos.a]).toEqual([semPagar.saldo1, semPagar.saldoFinal, semPagar.investimentos.a]);
  });

  it("quando o saldo cobre as contas, nada é resgatado", () => {
    const [nov] = computeCashflow({ ...settings, openingBalance: 5000 }, lines, inv, retiradas, { "2026-11": 2500 });
    expect([nov.resgatado, nov.saldoEmConta]).toEqual([0, 2500]);
  });

  it("sem o resgate automático, a conta fica negativa (o app avisa)", () => {
    const [nov] = computeCashflow({ ...settings, sweep: false }, lines, inv, retiradas, { "2026-11": 1800 });
    expect([nov.resgatado, nov.saldoEmConta]).toEqual([0, -800]);
  });
});
