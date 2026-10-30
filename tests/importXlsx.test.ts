import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { importCashflowXlsx } from "../server/importXlsx";
import { computeCashflow } from "../src/lib/cashflow";

/** Monta uma planilha no layout da aba "Fluxo de Caixa (2)" (meses fora de ordem, como na original). */
async function sampleWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Fluxo de Caixa (2)");
  const months = [new Date(Date.UTC(2027, 0, 1)), new Date(Date.UTC(2026, 10, 1)), new Date(Date.UTC(2026, 11, 1))];
  ws.addRow(["", "Base", ...months]);
  ws.addRow(["Saldo Inicial", null, { formula: "D25" }, 1000, { formula: "C25" }]); // 2
  ws.addRow(["Cartão Itau", -2000, -2000, -5000, -2000]); // 3
  ws.addRow(["Condomínio", 0, -1000, -1000, -1000]); // 4
  ws.addRow(["Saldo 1"]); // 5
  ws.addRow(["Resgate"]); // 6
  ws.addRow(["Saldo 2"]); // 7
  ws.addRow(["Salário", 0, 10000, 10000, 10000]); // 8
  ws.addRow(["DESPESAS EMPRESA", null, { formula: "C20", result: -600 }, { formula: "D20", result: -600 }, { formula: "E20", result: -600 }]); // 9
  ws.addRow(["13º salário", 0, null, null, 8000]); // 10
  ws.addRow(["Saldo final"]); // 11
  ws.addRow(["Nubank", 0, { formula: "E12*(1+0.5%)", result: 1015.05 }, 1000, { formula: "D12*(1+0.5%)", result: 1005 }]); // 12
  ws.addRow(["TT INVESTIMENTO"]); // 13
  for (let i = 14; i < 20; i++) ws.addRow([]);
  ws.addRow(["Empresa", null, { formula: "SUM(C21:C22)", result: -600 }]); // 20
  ws.addRow(["Impostos PJ", null, -500, -500, -500]); // 21
  ws.addRow(["Contabilidade", null, -100, -100, -100]); // 22
  ws.addRow([]);
  ws.addRow(["Previdência", null, { formula: "E24*(1+0.5%)", result: 2010.01 }, 2000, { formula: "D24*(1+0.5%)", result: 2010 }]); // 24
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

describe("importCashflowXlsx", () => {
  it("lê meses, blocos, despesas da empresa e investimentos", async () => {
    const r = await importCashflowXlsx(await sampleWorkbook());
    expect(r.settings).toEqual({ startMonth: "2026-11", months: 3, openingBalance: 1000, sweep: true });
    const byName = Object.fromEntries(r.lines.map((l) => [l.name, l]));
    expect(byName["Cartão Itau"].group).toBe("pessoal");
    expect(byName["Cartão Itau"].values).toEqual({ "2026-11": -5000, "2026-12": -2000, "2027-01": -2000 });
    expect(byName["Salário"].group).toBe("renda");
    expect(byName["13º salário"].values).toEqual({ "2026-12": 8000 });
    expect(byName["Impostos PJ"].group).toBe("empresa");
    expect(byName["Contabilidade"].group).toBe("empresa");
    expect(byName["DESPESAS EMPRESA"]).toBeUndefined();
    expect(r.investments.map((i) => [i.name, i.kind, i.sweepTarget])).toEqual([
      ["Nubank", "investimento", true],
      ["Previdência", "previdencia", false],
    ]);
    expect(r.investments[0].balance).toBeCloseTo(1000 / 1.005, 1);

    const [nov, dez] = computeCashflow(r.settings, r.lines, r.investments);
    expect(nov.saldo1).toBe(1000 - 5000 - 1000);
    expect(nov.saldoFinal).toBe(10000 - 600);
    expect(dez.saldoFinal).toBe(10000 - 600 + 8000);
  });
});
