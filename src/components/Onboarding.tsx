import { useStore } from "../lib/store";

/** Primeiro acesso: pergunta se a renda vem de salário (CLT) ou da própria empresa (PJ). */
export function Onboarding({ onPj }: { onPj: () => void }) {
  const { state, update } = useStore();
  if (state.onboarded !== false) return null;

  const choose = (pj: boolean) => {
    update((s) => ({
      ...s,
      onboarded: true,
      company: { ...s.company, enabled: pj },
      // PJ: o salário de exemplo sai do fluxo pessoal, porque a renda passa a vir da empresa.
      lines: pj ? s.lines.filter((l) => !(l.group === "renda" && /sal[aá]rio/i.test(l.name))) : s.lines,
    }));
    if (pj) onPj();
  };

  return (
    <div className="card onboarding" style={{ marginBottom: 16 }}>
      <div>
        <h2 style={{ marginBottom: 4 }}>Bem-vindo! Como você recebe sua renda?</h2>
        <p className="sub" style={{ fontSize: 13 }}>
          Os valores do app são exemplos — substitua pelos seus no Fluxo pessoal ou importe sua planilha. Você pode mudar isso depois.
        </p>
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => choose(false)}>
          💼 Salário (CLT)
        </button>
        <button className="btn" onClick={() => choose(true)}>
          🏢 Pela minha empresa (PJ)
        </button>
      </div>
    </div>
  );
}
