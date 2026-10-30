import { addMonths, currentMonth, monthRange } from "./months";
import type { AppState, Bill, CompanyLine, FlowLine, LineGroup, Transaction } from "./types";

let seq = 0;
export const uid = (p = "id") => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function line<G extends string = LineGroup>(name: string, category: string, group: G, months: string[], value: number | ((i: number) => number)): FlowLine<G> {
  return {
    id: uid("l"),
    name,
    category,
    group,
    values: Object.fromEntries(
      months.map((m, i) => [m, typeof value === "number" ? value : value(i)]).filter(([, v]) => v !== 0),
    ),
  };
}

/**
 * Dados de exemplo para quem acabou de entrar: perfil CLT simples, com poucas linhas e valores modestos.
 * A empresa (PJ) vem com um exemplo pequeno, mas desligada; o usuário liga se receber pela empresa.
 */
export function demoState(now = new Date()): AppState {
  const start = currentMonth(now);
  const months = monthRange(start, 12);
  const dec = months.findIndex((m) => m.endsWith("-12"));

  const lines: FlowLine[] = [
    line("Aluguel + condomínio", "Moradia", "pessoal", months, -1800),
    line("Cartão de crédito", "Cartões", "pessoal", months, -1200),
    line("Mercado", "Alimentação", "pessoal", months, -900),
    line("Luz + internet", "Moradia", "pessoal", months, -250),
    line("Transporte", "Transporte", "pessoal", months, -400),
    line("Lazer", "Lazer", "pessoal", months, -300),
    line("Salário", "Renda", "renda", months, 6500),
    line("13º salário", "Renda", "renda", months, (i) => (i === dec ? 6500 : 0)),
  ];
  const companyLines: CompanyLine[] = [
    line("Faturamento", "Renda", "faturamento", months, 8000),
    { ...line("Simples Nacional", "Impostos", "despesa", months, 0), pctFaturamento: 0.06 },
    line("Contabilidade", "Impostos", "despesa", months, -300),
    line("Pró-labore", "Renda", "retirada", months, 1500),
    { ...line("Lucro distribuído", "Renda", "retirada", months, 0), auto: true },
  ];
  // Base (orçamento mensal) = valor mais frequente de cada linha, como na coluna B da planilha.
  for (const l of [...lines, ...companyLines]) {
    const freq = new Map<number, number>();
    for (const v of Object.values(l.values)) freq.set(v, (freq.get(v) ?? 0) + 1);
    const top = [...freq].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] > 1) l.base = top[0];
  }

  return {
    version: 1,
    settings: { startMonth: start, months: 12, openingBalance: 6500, sweep: true },
    lines,
    company: { name: "Minha empresa", openingBalance: 0, lines: companyLines, enabled: false },
    investments: [
      { id: uid("i"), name: "Reserva (CDB liquidez diária)", balance: 5000, monthlyRate: 0.008, sweepTarget: true, kind: "investimento" },
      { id: uid("i"), name: "Tesouro Direto", balance: 3000, monthlyRate: 0.006, sweepTarget: false, kind: "investimento" },
    ],
    transactions: demoTransactions(start, now.getDate()),
    goals: [
      { id: uid("g"), name: "Reserva de emergência (6 meses)", target: 30000, saved: 5000, deadline: addMonths(start, 18), icon: "🛟" },
      { id: uid("g"), name: "Viagem de férias", target: 6000, saved: 1000, deadline: addMonths(start, 10), icon: "✈️" },
    ],
    bills: ([
      { id: uid("b"), name: "Aluguel + condomínio", amount: 1800, dueDay: 5, category: "Moradia", paid: [] },
      { id: uid("b"), name: "Fatura do cartão", amount: 1200, dueDay: 10, category: "Cartões", paid: [] },
      { id: uid("b"), name: "Luz + internet", amount: 250, dueDay: 20, category: "Moradia", paid: [] },
    ] as Bill[]).map((b) => (b.dueDay < now.getDate() - 2 ? { ...b, paid: [start] } : b)),
    connections: [],
    onboarded: false,
  };
}

/** Três meses de lançamentos fictícios e o mês atual até hoje, para os gráficos e a IA terem histórico. */
function demoTransactions(start: string, today: number): Transaction[] {
  const rnd = mulberry32(42);
  const out: Transaction[] = [];
  const recurring: [string, string, number, number][] = [
    ["Salário", "Renda", 6500, 5],
    ["Aluguel + condomínio", "Moradia", -1800, 5],
    ["Luz + internet", "Moradia", -250, 20],
  ];
  const variable: [string, string, number][] = [
    ["Supermercado", "Alimentação", 180],
    ["Restaurante", "Alimentação", 60],
    ["iFood", "Alimentação", 45],
    ["Posto de gasolina", "Transporte", 150],
    ["Farmácia", "Saúde", 50],
    ["Cinema", "Lazer", 40],
    ["Compras online", "Diversos", 90],
  ];
  for (let k = 3; k >= 0; k--) {
    const m = addMonths(start, -k);
    const maxDay = k === 0 ? today : 28;
    for (const [d, c, v, day] of recurring)
      if (day <= maxDay) out.push({ id: uid("t"), date: `${m}-${String(day).padStart(2, "0")}`, description: d, amount: v, category: c, account: "Conta corrente", source: "manual" });
    // Gastos variáveis crescendo um pouco a cada mês, para a previsão ter tendência.
    const n = Math.round((10 + (3 - k) * 2) * (maxDay / 28));
    for (let j = 0; j < n; j++) {
      const [d, c, base] = variable[Math.floor(rnd() * variable.length)];
      const day = 1 + Math.floor(rnd() * maxDay);
      const v = Math.round(base * (0.6 + rnd() * 0.9) * (1 + (3 - k) * 0.06) * 100) / 100;
      out.push({ id: uid("t"), date: `${m}-${String(day).padStart(2, "0")}`, description: d, amount: -v, category: c, account: "Cartão de crédito", source: "manual" });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
