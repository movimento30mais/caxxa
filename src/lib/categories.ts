export interface Category {
  name: string;
  keywords: string[];
}

export const CATEGORIES: Category[] = [
  { name: "Cartões", keywords: ["cartão", "cartao", "fatura", "itau", "itaú", "bradesco", "nubank", "bb"] },
  { name: "Moradia", keywords: ["condomínio", "condominio", "aluguel", "iptu", "ap ", "apart", "luz", "energia", "água", "agua", "gás", "gas "] },
  { name: "Transporte", keywords: ["carro", "gasolina", "combust", "posto", "pedágio", "pedagio", "estac", "ipva", "uber", "99"] },
  { name: "Saúde", keywords: ["sulamerica", "sulamérica", "unimed", "amil", "farmácia", "farmacia", "drogaria", "plano de saúde", "saúde"] },
  { name: "Seguros", keywords: ["seguro", "prudential", "prutendial", "porto"] },
  { name: "Alimentação", keywords: ["alimentação", "alimentacao", "mercado", "supermerc", "ifood", "restaurante", "padaria"] },
  { name: "Serviços", keywords: ["tv", "internet", "telefone", "celular", "streaming", "netflix", "spotify", "diarista", "funcionária"] },
  { name: "Impostos", keywords: ["imposto", "inss", "darf", "das ", "contabil"] },
  { name: "Lazer", keywords: ["viagem", "cinema", "show", "lazer", "hotel"] },
  { name: "Diversos", keywords: ["diversos", "outros"] },
  { name: "Renda", keywords: ["salário", "salario", "13º", "férias", "ferias", "pró-labore", "rendimento"] },
];

export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);

/** Categoriza automaticamente pela descrição (usado na importação da planilha e no Open Finance). */
export function guessCategory(description: string, amount = -1): string {
  const d = ` ${description.toLowerCase()} `;
  for (const c of CATEGORIES) if (c.keywords.some((k) => d.includes(k))) return c.name;
  return amount > 0 ? "Renda" : "Diversos";
}
