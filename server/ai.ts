import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const MODEL = "claude-opus-5-5";

export const AdviceSchema = z.object({
  resumo: z.string().describe("Duas ou três frases sobre a saúde financeira do mês."),
  insights: z
    .array(
      z.object({
        titulo: z.string(),
        detalhe: z.string(),
        prioridade: z.enum(["alta", "media", "baixa"]),
        impactoMensal: z.number().describe("Economia ou custo mensal estimado em reais; 0 se não se aplica."),
      }),
    )
    .describe("De 3 a 6 recomendações acionáveis, da mais para a menos importante."),
  previsao: z.object({
    gastosProximoMes: z.number().describe("Total de gastos previsto para o próximo mês, em reais."),
    comentario: z.string(),
  }),
  resposta: z.string().describe("Resposta à pergunta do usuário; string vazia se não houve pergunta."),
});
export type Advice = z.infer<typeof AdviceSchema>;

const SYSTEM = `Você é o assistente financeiro do Caxxa, um app brasileiro de controle financeiro pessoal.
Você recebe um resumo agregado das finanças do usuário: fluxo de caixa projetado mês a mês (no modelo de planilha:
Saldo Inicial + despesas pessoais = Saldo 1; a sobra ou o déficit do Saldo 1 é aplicado ou resgatado dos investimentos;
o salário e as despesas da empresa (PJ) entram depois e formam o Saldo final, que é o Saldo Inicial do mês seguinte),
histórico de receitas e despesas, gastos por categoria, orçamento planejado, metas, contas a vencer e investimentos.

Dê recomendações concretas e personalizadas, citando valores em reais e meses específicos dos dados.
Use português do Brasil e formate valores como "R$ 1.234". Não invente números que não estejam nos dados ou que não
sejam derivados deles. Não recomende produtos financeiros de instituições específicas; fale em classes de ativo.
Se a previsão local parecer razoável, use-a como base para a previsão de gastos e explique ajustes.`;

let client: Anthropic | null = null;

export function aiAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export class AiRefusal extends Error {}

export async function getAdvice(summary: unknown, question?: string): Promise<Advice> {
  client ??= new Anthropic();
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // Se o modelo recusar por política, a API refaz a chamada no modelo de fallback recomendado.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: zodOutputFormat(AdviceSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Dados financeiros (JSON):\n${JSON.stringify(summary)}\n\n${
          question?.trim() ? `Pergunta do usuário: ${question.trim()}` : "O usuário não fez pergunta; deixe \"resposta\" vazia."
        }`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new AiRefusal("A IA não pôde responder a esta solicitação.");
  if (!response.parsed_output) throw new Error("Resposta da IA em formato inesperado.");
  return response.parsed_output;
}
