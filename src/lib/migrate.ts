import type { CompanyLine, CompanyState, FlowLine, LineGroup } from "./types";

/** Linha no formato antigo, quando as despesas da PJ ficavam no fluxo pessoal (grupo "empresa"). */
export type LegacyLine = Omit<FlowLine, "group"> & { group: LineGroup | "empresa" };

let n = 0;
const id = (p: string) => `${p}_mig${Date.now().toString(36)}${(n++).toString(36)}`;

/** Retiradas padrão: pró-labore (lançado) + lucro distribuído automaticamente. */
export function defaultWithdrawals(): CompanyLine[] {
  return [
    { id: id("c"), name: "Pró-labore", category: "Renda", group: "retirada", values: {} },
    { id: id("c"), name: "Lucro distribuído", category: "Renda", group: "retirada", values: {}, auto: true },
  ];
}

/**
 * Separa a empresa do fluxo pessoal no formato antigo (o da planilha): a linha "Salário" vira o faturamento da PJ,
 * as despesas da empresa vão para o fluxo da empresa e o lucro automático devolve ao pessoal exatamente
 * Salário − despesas PJ — o saldo final pessoal não muda.
 */
export function splitCompany(lines: LegacyLine[], name = "Empresa"): { lines: FlowLine[]; company: CompanyState } {
  const despesas = lines.filter((l) => l.group === "empresa");
  const salario = despesas.length ? lines.find((l) => l.group === "renda" && /sal[aá]rio/i.test(l.name) && Object.keys(l.values).length) : undefined;
  const company: CompanyState = {
    name,
    openingBalance: 0,
    lines: [
      ...(salario ? [{ ...salario, name: "Faturamento", category: "Renda", group: "faturamento" as const }] : []),
      ...despesas.map((l) => ({ ...l, group: "despesa" as const })),
      ...defaultWithdrawals(),
    ],
  };
  const personal = lines.filter((l): l is FlowLine => l.group !== "empresa" && l !== salario);
  return { lines: personal, company };
}
