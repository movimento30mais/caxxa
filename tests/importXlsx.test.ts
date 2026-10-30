import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { importCashflowXlsx } from "../server/importXlsx";
import { computeCashflow, plannedByCategory } from "../src/lib/cashflow";
import { companyBase, computeCompany } from "../src/lib/company";

/** Monta uma planilha no layout da aba "Fluxo de Caixa (2)" (coluna Base e meses fora de ordem, como na original). */
async function sampleWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Fluxo de Caixa (2)");
  const months = [new Date(Date.UTC(2027, 0, 1)), new Date(Date.UTC(2026, 10, 1)), new Date(Date.UTC(2026, 11, 1))];
  ws.addRow(["", "Base", ...months]);
  ws.addRow(["Saldo Inicial", null, { formula: "D26" }, 1000, { formula: "C26" }]); // 2
  ws.addRow(["Salário", { formula: "10000-400", result: 9600 }]); // 3: só Base, como na planilha original
  ws.addRow(["Cartão Itau", -2000, -2000, -5000, -2000]); // 4
  ws.addRow(["Condomínio", -1200, -1000, -1000, -1000]); // 5
  ws.addRow(["Saldo 1", { formula: "SUM(B3:B5)", result: 6400 }]); // 6
  ws.addRow(["Resgate"]); // 7
  ws.addRow(["Saldo 2"]); // 8
  ws.addRow(["Salário", 0, 10000, 10000, 10000]); // 9
  ws.addRow(["DESPESAS EMPRESA", null, { formula: "C21", result: -600 }, { formula: "D21", result: -600 }, { formula: "E21", result: -600 }]); // 10
  ws.addRow(["13º salário", 0, null, null, 8000]); // 11
  ws.addRow(["Saldo final"]); // 12
  ws.addRow(["Nubank", 0, { formula: "E13*(1+0.5%)", result: 1015.05 }, 1000, { formula: "D13*(1+0.5%)", result: 1005 }]); // 13
  ws.addRow(["TT INVESTIMENTO"]); // 14
  for (let i = 15; i < 21; i++) ws.addRow([]);
  ws.addRow(["Empresa", null, { formula: "SUM(C22:C23)", result: -600 }]); // 21
  ws.addRow(["Impostos PJ", -550, -500, -500, -500]); // 22
  ws.addRow(["Contabilidade", -100, -100, -100, -100]); // 23
  ws.addRow([]);
  ws.addRow(["Previdência", null, { formula: "E25*(1+0.5%)", result: 2010.01 }, 2000, { formula: "D25*(1+0.5%)", result: 2010 }]); // 25
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

describe("importCashflowXlsx", () => {
  it("lê meses, blocos, despesas da empresa e investimentos", async () => {
    const r = await importCashflowXlsx(await sampleWorkbook());
    expect(r.settings).toEqual({ startMonth: "2026-11", months: 3, openingBalance: 1000, sweep: true });
    const byName = Object.fromEntries(r.lines.map((l) => [l.name, l]));
    expect(byName["Cartão Itau"].group).toBe("pessoal");
    expect(byName["Cartão Itau"].values).toEqual({ "2026-11": -5000, "2026-12": -2000, "2027-01": -2000 });
    expect(byName["13º salário"].values).toEqual({ "2026-12": 8000 });
    // A PJ vai para o fluxo da empresa: Salário → Faturamento, despesas PJ → despesas.
    const pj = Object.fromEntries(r.company.lines.map((l) => [l.name, l]));
    expect(pj["Faturamento"]).toMatchObject({ group: "faturamento", values: { "2026-11": 10000 } });
    expect(pj["Impostos PJ"].group).toBe("despesa");
    expect(pj["Contabilidade"].group).toBe("despesa");
    expect(pj["Lucro distribuído"].auto).toBe(true);
    expect(byName["Impostos PJ"]).toBeUndefined();
    expect(byName["Salário"]).toBeUndefined();
    expect(byName["DESPESAS EMPRESA"]).toBeUndefined();
    expect(r.investments.map((i) => [i.name, i.kind, i.sweepTarget])).toEqual([
      ["Nubank", "investimento", true],
      ["Previdência", "previdencia", false],
    ]);
    expect(r.investments[0].balance).toBeCloseTo(1000 / 1.005, 1);

    const pjFlow = computeCompany(r.settings, r.company);
    const [nov, dez] = computeCashflow(r.settings, r.lines, r.investments, Object.fromEntries(pjFlow.map((c) => [c.month, c.retiradas])));
    expect(nov.saldo1).toBe(1000 - 5000 - 1000);
    expect(nov.saldoFinal).toBe(10000 - 600);
    expect(dez.saldoFinal).toBe(10000 - 600 + 8000);
  });

  it("lê a coluna Base como orçamento mensal", async () => {
    const r = await importCashflowXlsx(await sampleWorkbook());
    const byName = Object.fromEntries(r.lines.map((l) => [l.name, l]));
    const pj = Object.fromEntries(r.company.lines.map((l) => [l.name, l]));
    expect(byName["Cartão Itau"].base).toBe(-2000);
    expect(byName["Condomínio"].base).toBe(-1200);
    expect(pj["Impostos PJ"].base).toBe(-550);
    expect(byName["13º salário"].base).toBe(0); // zero explícito na planilha
    expect(r.lines.find((l) => l.name === "Nubank")).toBeUndefined();
    // O "Salário" só com Base no bloco de despesas vira a Base do faturamento da empresa.
    expect(pj["Faturamento"]).toMatchObject({ base: 9600, values: { "2026-11": 10000 } });
    expect(companyBase(r.company).retiradas).toBe(9600 - 550 - 100);
    // O orçamento usa a Base, não o valor projetado do mês (nov tem −5.000 no cartão).
    expect(plannedByCategory(r.lines, "2026-11")).toEqual({ Cartões: 2000, Moradia: 1200 });
  });
});
