import { useState } from "react";
import { CategoryBars, InsightList, PageHead, Stat } from "../components/ui";
import { aiPayload, localInsights, type Snapshot } from "../lib/analytics";
import { api, type Advice, type ServerStatus } from "../lib/api";
import { addMonths, fmt0, monthLabel } from "../lib/months";
import { useStore } from "../lib/store";

const SUGESTOES = [
  "Onde consigo economizar R$ 2.000 por mês?",
  "Consigo antecipar a meta da reserva de emergência?",
  "Quanto devo deixar em liquidez para os meses de resgate?",
];

export default function Assistant({ snap, status }: { snap: Snapshot; status: ServerStatus | null }) {
  const { state } = useStore();
  const [question, setQuestion] = useState("");
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const local = localInsights(state, snap);
  const next = addMonths(snap.month, 1);
  const previsto = snap.forecast.reduce((a, f) => a + f.previsto, 0);

  async function ask(q = question) {
    setLoading(true);
    setError(null);
    try {
      setAdvice(await api.advice(aiPayload(state, snap), q));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHead title="Assistente IA" sub="Previsões de gastos e recomendações personalizadas a partir do seu fluxo de caixa e lançamentos." />

      <div className="grid g3">
        <Stat label={`Gastos previstos para ${monthLabel(next)}`} value={fmt0(advice?.previsao.gastosProximoMes ?? previsto)} delta={advice ? "previsão da IA" : "média ponderada + tendência"} />
        <Stat label="Recomendações de alta prioridade" value={String((advice?.insights ?? local).filter((i) => i.prioridade === "alta").length)} />
        <Stat label="Motor de análise" value={status?.ai ? "Claude" : "Local"} delta={status?.ai ? "envia apenas totais agregados" : "defina ANTHROPIC_API_KEY para usar a IA"} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Pergunte sobre suas finanças</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <input type="text" style={{ flex: 1, minWidth: 220 }} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="ex.: Posso trocar de carro no meio do ano?" />
          <button className="btn primary" disabled={loading || !status?.ai}>
            {loading ? "Analisando…" : question.trim() ? "Perguntar" : "Gerar análise"}
          </button>
        </form>
        <div className="row" style={{ marginTop: 8 }}>
          {SUGESTOES.map((s) => (
            <button
              key={s}
              className="btn small"
              disabled={loading || !status?.ai}
              onClick={() => {
                setQuestion(s);
                void ask(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
        {!status?.ai && (
          <p className="notice" style={{ marginTop: 12 }}>
            A IA não está configurada no servidor. As recomendações abaixo são calculadas localmente; para análises do Claude, defina <code>ANTHROPIC_API_KEY</code>.
          </p>
        )}
        {error && (
          <p className="notice err" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
        {advice && (
          <div style={{ marginTop: 14 }}>
            <p style={{ fontSize: 15 }}>{advice.resumo}</p>
            {advice.resposta && (
              <div className="notice ai-answer" style={{ marginTop: 10 }}>
                {advice.resposta}
              </div>
            )}
            <p className="sub" style={{ marginTop: 8 }}>
              Previsão: {advice.previsao.comentario}
            </p>
          </div>
        )}
      </div>

      <div className="grid g3" style={{ marginTop: 16 }}>
        <div className="card span2">
          <div className="card-head">
            <h2>{advice ? "Recomendações da IA" : "Recomendações"}</h2>
            {advice && (
              <button className="btn small" onClick={() => setAdvice(null)}>
                Ver análise local
              </button>
            )}
          </div>
          <InsightList items={advice?.insights ?? local} />
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Previsão por categoria</h2>
            <span className="sub">{monthLabel(next)}</span>
          </div>
          <CategoryBars
            data={snap.forecast.map((f) => ({ name: f.category, previsto: Math.round(f.previsto) }))}
            series={[{ key: "previsto", label: "Previsto", color: "var(--series-1)" }]}
          />
        </div>
      </div>
    </>
  );
}
