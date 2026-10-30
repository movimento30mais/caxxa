import { addMonths, currentMonth, monthRange } from "./months";
import type { AppState, Bill, FlowLine, LineGroup, Transaction } from "./types";

let seq = 0;
export const uid = (p = "id") => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function line(name: string, category: string, group: LineGroup, months: string[], value: number | ((i: number) => number)): FlowLine {
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

/** Dados de exemplo com a mesma estrutura da aba "Fluxo de Caixa (2)". Importe sua planilha para substituí-los. */
export function demoState(now = new Date()): AppState {
  const start = currentMonth(now);
  const months = monthRange(start, 12);
  const at = (i: number) => (j: number) => (j === i ? 1 : 0);
  const dec = months.findIndex((m) => m.endsWith("-12"));

  const lines: FlowLine[] = [
    line("Cartão principal", "Cartões", "pessoal", months, -2000),
    line("Cartão secundário", "Cartões", "pessoal", months, -1500),
    line("Plano de saúde", "Saúde", "pessoal", months, -2380),
    line("Condomínio", "Moradia", "pessoal", months, -2200),
    line("Diarista", "Serviços", "pessoal", months, -3800),
    line("Financiamento carro", "Transporte", "pessoal", months, -2030),
    line("Gasolina", "Transporte", "pessoal", months, -1000),
    line("Pedágio + estacionamento", "Transporte", "pessoal", months, -420),
    line("Seguro auto", "Seguros", "pessoal", months, (i) => (i >= 3 && i <= 6 ? -625 : 0)),
    line("Seguro residencial", "Seguros", "pessoal", months, (i) => (i >= 3 && i <= 6 ? -500 : 0)),
    line("IPVA", "Transporte", "pessoal", months, (i) => (i >= 2 && i <= 6 ? -500 : 0)),
    line("IPTU", "Moradia", "pessoal", months, (i) => (i >= 3 ? -900 : 0)),
    line("Alimentação", "Alimentação", "pessoal", months, -1100),
    line("Mercado", "Alimentação", "pessoal", months, -1500),
    line("Luz", "Moradia", "pessoal", months, -250),
    line("TV + internet", "Serviços", "pessoal", months, -270),
    line("Seguro de vida", "Seguros", "pessoal", months, -800),
    line("Diversos", "Diversos", "pessoal", months, -2000),
    line("Salário", "Renda", "renda", months, 32000),
    line("13º salário", "Renda", "renda", months, (i) => (dec >= 0 ? at(dec)(i) * 30000 : 0)),
    line("Impostos PJ", "Impostos", "empresa", months, -3700),
    line("INSS", "Impostos", "empresa", months, -180),
    line("Contabilidade", "Impostos", "empresa", months, -420),
  ];

  return {
    version: 1,
    settings: { startMonth: start, months: 12, openingBalance: 28000, sweep: true },
    lines,
    investments: [
      { id: uid("i"), name: "Reserva (CDB liquidez diária)", balance: 45000, monthlyRate: 0.008, sweepTarget: true, kind: "investimento" },
      { id: uid("i"), name: "Tesouro IPCA+", balance: 120000, monthlyRate: 0.005, sweepTarget: false, kind: "investimento" },
      { id: uid("i"), name: "Fundos multimercado", balance: 60000, monthlyRate: 0.005, sweepTarget: false, kind: "investimento" },
      { id: uid("i"), name: "Previdência", balance: 90000, monthlyRate: 0.005, sweepTarget: false, kind: "previdencia" },
    ],
    transactions: demoTransactions(start, now.getDate()),
    goals: [
      { id: uid("g"), name: "Reserva de emergência (6 meses)", target: 150000, saved: 45000, deadline: addMonths(start, 18), icon: "🛟" },
      { id: uid("g"), name: "Viagem em família", target: 25000, saved: 6000, deadline: addMonths(start, 9), icon: "✈️" },
      { id: uid("g"), name: "Entrada do apartamento novo", target: 200000, saved: 80000, deadline: addMonths(start, 30), icon: "🏠" },
    ],
    bills: ([
      { id: uid("b"), name: "Condomínio", amount: 2200, dueDay: 5, category: "Moradia", paid: [] },
      { id: uid("b"), name: "Plano de saúde", amount: 2380, dueDay: 10, category: "Saúde", paid: [] },
      { id: uid("b"), name: "Fatura cartão principal", amount: 2000, dueDay: 15, category: "Cartões", paid: [] },
      { id: uid("b"), name: "Financiamento carro", amount: 2030, dueDay: 20, category: "Transporte", paid: [] },
      { id: uid("b"), name: "Luz", amount: 250, dueDay: 25, category: "Moradia", paid: [] },
      { id: uid("b"), name: "TV + internet", amount: 270, dueDay: 28, category: "Serviços", paid: [] },
    ] as Bill[]).map((b) => (b.dueDay < now.getDate() - 2 ? { ...b, paid: [start] } : b)),
    connections: [],
  };
}

/** Três meses de lançamentos fictícios e o mês atual até hoje, para os gráficos e a IA terem histórico. */
function demoTransactions(start: string, today: number): Transaction[] {
  const rnd = mulberry32(42);
  const out: Transaction[] = [];
  const recurring: [string, string, number, number][] = [
    ["Salário", "Renda", 32000, 1],
    ["Condomínio", "Moradia", -2200, 5],
    ["Plano de saúde", "Saúde", -2380, 10],
    ["Diarista", "Serviços", -3800, 6],
    ["Financiamento carro", "Transporte", -2030, 20],
    ["Luz", "Moradia", -250, 25],
    ["TV + internet", "Serviços", -270, 28],
    ["Seguro de vida", "Seguros", -800, 12],
  ];
  const variable: [string, string, number][] = [
    ["Supermercado", "Alimentação", 380],
    ["Restaurante", "Alimentação", 160],
    ["iFood", "Alimentação", 85],
    ["Posto de gasolina", "Transporte", 260],
    ["Estacionamento", "Transporte", 35],
    ["Farmácia", "Saúde", 120],
    ["Cinema", "Lazer", 90],
    ["Compras online", "Diversos", 240],
  ];
  for (let k = 3; k >= 0; k--) {
    const m = addMonths(start, -k);
    const maxDay = k === 0 ? today : 28;
    for (const [d, c, v, day] of recurring)
      if (day <= maxDay) out.push({ id: uid("t"), date: `${m}-${String(day).padStart(2, "0")}`, description: d, amount: v, category: c, account: "Conta corrente", source: "manual" });
    // Gastos variáveis crescendo um pouco a cada mês, para a previsão ter tendência.
    const n = Math.round((22 + (3 - k) * 4) * (maxDay / 28));
    for (let j = 0; j < n; j++) {
      const [d, c, base] = variable[Math.floor(rnd() * variable.length)];
      const day = 1 + Math.floor(rnd() * maxDay);
      const v = Math.round(base * (0.6 + rnd() * 0.9) * (1 + (3 - k) * 0.06) * 100) / 100;
      out.push({ id: uid("t"), date: `${m}-${String(day).padStart(2, "0")}`, description: d, amount: -v, category: c, account: "Cartão principal", source: "manual" });
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
