import ExcelJS from "exceljs";
import { guessCategory } from "../src/lib/categories";
import { splitCompany, type LegacyLine } from "../src/lib/migrate";
import type { CashflowSettings, CompanyState, FlowLine, Investment } from "../src/lib/types";

export interface ImportResult {
  sheet: string;
  settings: CashflowSettings;
  lines: FlowLine[];
  company: CompanyState;
  investments: Investment[];
}

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

function num(v: ExcelJS.CellValue): number | null {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "result" in v) {
    const r = (v as { result?: unknown }).result;
    return typeof r === "number" ? r : null;
  }
  return null;
}

function formulaOf(cell: ExcelJS.Cell): string {
  try {
    return cell.formula ?? "";
  } catch {
    return "";
  }
}

let n = 0;
const id = (p: string) => `${p}_imp${Date.now().toString(36)}${(n++).toString(36)}`;
const cents = (v: number) => Math.round(v * 100) / 100;

/**
 * Lê uma planilha no formato da aba "Fluxo de Caixa (2)":
 * linha 1 com os meses, blocos "Saldo Inicial" → "Saldo 1" (despesas pessoais),
 * "Saldo 2" → "Saldo final" (salário, despesas da empresa, extras — separados no fluxo da empresa) e,
 * abaixo, os investimentos até "TT INVESTIMENTO" e a "Previdência".
 */
export async function importCashflowXlsx(buffer: ArrayBuffer, preferredSheet = "Fluxo de Caixa (2)"): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws =
    wb.getWorksheet(preferredSheet) ??
    wb.worksheets.find((w) => {
      for (let r = 1; r <= Math.min(w.rowCount, 10); r++) if (norm(w.getCell(r, 1).text) === "saldo inicial") return true;
      return false;
    });
  if (!ws) throw new Error('Nenhuma aba com a linha "Saldo Inicial" foi encontrada.');

  // Colunas de mês (datas na linha 1), em ordem cronológica.
  const cols: { col: number; month: string }[] = [];
  ws.getRow(1).eachCell((cell, col) => {
    const v = cell.value;
    if (v instanceof Date) cols.push({ col, month: `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}` });
  });
  if (!cols.length) throw new Error("A linha 1 precisa conter os meses como datas.");
  cols.sort((a, b) => a.month.localeCompare(b.month));
  // Coluna "Base" (orçamento mensal de cada linha), normalmente a B.
  let baseCol: number | null = null;
  ws.getRow(1).eachCell((cell, col) => {
    if (norm(cell.text) === "base") baseCol = col;
  });

  const labelRow: Record<string, number> = {};
  const lastRow = ws.rowCount;
  for (let r = 1; r <= lastRow; r++) {
    const k = norm(ws.getCell(r, 1).text);
    if (k && !(k in labelRow)) labelRow[k] = r;
  }
  const need = (k: string) => {
    if (!labelRow[k]) throw new Error(`Linha "${k}" não encontrada na planilha.`);
    return labelRow[k];
  };

  const rowValues = (r: number) => {
    const values: Record<string, number> = {};
    for (const { col, month } of cols) {
      const v = num(ws.getCell(r, col).value);
      if (v !== null && v !== 0) values[month] = cents(v);
    }
    return values;
  };

  const baseOf = (r: number) => {
    // Base 0 é orçamento zero; célula vazia é "sem Base".
    const v = baseCol === null ? null : num(ws.getCell(r, baseCol).value);
    return v === null ? undefined : cents(v);
  };

  const makeLine = (r: number, group: LegacyLine["group"]): LegacyLine | null => {
    const name = ws.getCell(r, 1).text.trim();
    const values = rowValues(r);
    const base = baseOf(r);
    if (!name || (!Object.keys(values).length && !base)) return null;
    const sample = base ?? Object.values(values)[0];
    const line: LegacyLine = { id: id("l"), name, group, category: group === "renda" ? "Renda" : group === "empresa" ? "Impostos" : guessCategory(name, sample), values };
    if (base !== undefined) line.base = base;
    return line;
  };

  const rInicial = need("saldo inicial");
  const rSaldo1 = need("saldo 1");
  const rSaldo2 = labelRow["saldo 2"] ?? rSaldo1 + 2;
  const rFinal = need("saldo final");

  const lines: LegacyLine[] = [];
  // Linha positiva só com Base no bloco de despesas (ex.: "Salário" = 40.000 − 784,41) é a receita orçada.
  const incomeBases: LegacyLine[] = [];
  for (let r = rInicial + 1; r < rSaldo1; r++) {
    const l = makeLine(r, "pessoal");
    if (!l) continue;
    if (!Object.keys(l.values).length && (l.base ?? 0) > 0) incomeBases.push(l);
    else lines.push(l);
  }

  for (let r = rSaldo2 + 1; r < rFinal; r++) {
    const label = norm(ws.getCell(r, 1).text);
    if (label.startsWith("despesas empresa")) {
      lines.push(...companyLines(r));
      continue;
    }
    const l = makeLine(r, "extra");
    if (!l) continue;
    if (Object.values(l.values).some((v) => v > 0) || (l.base ?? 0) > 0) {
      l.group = "renda";
      l.category = "Renda";
    }
    lines.push(l);
  }

  for (const inc of incomeBases) {
    const twin = lines.find((l) => l.group === "renda" && norm(l.name) === norm(inc.name));
    if (twin && !twin.base) twin.base = inc.base;
    else lines.push({ ...inc, group: "renda", category: "Renda" });
  }

  // "DESPESAS EMPRESA" aponta para um subtotal (ex.: =C42) que soma as linhas da PJ (=SUM(C43:C45)).
  function companyLines(r: number): LegacyLine[] {
    for (const { col } of cols) {
      const ref = /^=?\$?[A-Z]+\$?(\d+)$/.exec(formulaOf(ws!.getCell(r, col)));
      if (!ref) continue;
      const sub = Number(ref[1]);
      for (const { col: c2 } of cols) {
        const sum = /SUM\(\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)\)/i.exec(formulaOf(ws!.getCell(sub, c2)));
        if (sum) {
          const out: LegacyLine[] = [];
          for (let k = Number(sum[1]); k <= Number(sum[2]); k++) {
            const l = makeLine(k, "empresa");
            if (l) out.push(l);
          }
          return out;
        }
      }
      const single = makeLine(sub, "empresa");
      return single ? [single] : [];
    }
    const l = makeLine(r, "empresa");
    return l ? [l] : [];
  }

  // Investimentos: linhas entre "Saldo final" e "TT INVESTIMENTO", mais a "Previdência".
  const rateOf = (r: number) => {
    for (const { col } of cols) {
      const m = /\(1\+([\d.,]+)%\)/.exec(formulaOf(ws.getCell(r, col)));
      if (m) return Number(m[1].replace(",", ".")) / 100;
    }
    return 0.005;
  };
  const investments: Investment[] = [];
  const pushInvestment = (r: number, kind: Investment["kind"]) => {
    const name = ws.getCell(r, 1).text.trim();
    const first = num(ws.getCell(r, cols[0].col).value);
    if (!name || first === null) return;
    const monthlyRate = rateOf(r);
    // O valor da planilha é o saldo no fim do primeiro mês; o app guarda o saldo no início.
    investments.push({ id: id("i"), name, balance: cents(first / (1 + monthlyRate)), monthlyRate, sweepTarget: false, kind });
  };
  const rTotal = labelRow["tt investimento"];
  if (rTotal) for (let r = rFinal + 1; r < rTotal; r++) pushInvestment(r, "investimento");
  const rPrev = Object.entries(labelRow).find(([k]) => k.startsWith("previdencia"))?.[1];
  if (rPrev) pushInvestment(rPrev, "previdencia");
  const biggest = investments.filter((i) => i.kind === "investimento").sort((a, b) => b.balance - a.balance)[0];
  if (biggest) biggest.sweepTarget = true;

  const opening = num(ws.getCell(rInicial, cols[0].col).value) ?? 0;
  const resgateRow = labelRow["resgate"];
  // A planilha mistura a PJ no fluxo pessoal; o app separa: "Salário" vira o faturamento e as despesas PJ vão para a empresa.
  const split = splitCompany(lines);
  return {
    sheet: ws.name,
    settings: { startMonth: cols[0].month, months: cols.length, openingBalance: cents(opening), sweep: Boolean(resgateRow) },
    lines: split.lines,
    company: split.company,
    investments,
  };
}
