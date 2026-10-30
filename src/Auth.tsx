import { useEffect, useState, type ReactNode } from "react";
import { api, type Session } from "./lib/api";

type Gate = { state: "loading" } | { state: "login"; signupEnabled: boolean } | { state: "in"; session: Session };

/** Mostra o login/cadastro quando o servidor exige e entrega a sessão para o app. */
export function AuthGate({ children }: { children: (session: Session, logout: () => void) => ReactNode }) {
  const [gate, setGate] = useState<Gate>({ state: "loading" });

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (r) => {
        const body = (await r.json()) as Session & { signupEnabled?: boolean };
        setGate(r.ok ? { state: "in", session: body } : { state: "login", signupEnabled: Boolean(body.signupEnabled) });
      })
      // Sem servidor (ex.: só o front em dev) segue como usuário local.
      .catch(() => setGate({ state: "in", session: { user: "local", authEnabled: false } }));
  }, []);

  if (gate.state === "loading") return <div className="login-wrap" aria-busy="true" />;
  if (gate.state === "login") return <Login signupEnabled={gate.signupEnabled} onLogin={(session) => setGate({ state: "in", session })} />;
  const logout = () => {
    void api.logout().finally(() => setGate({ state: "login", signupEnabled: Boolean(gate.session.signupEnabled) }));
  };
  return <>{children(gate.session, logout)}</>;
}

function Login({ signupEnabled, onLogin }: { signupEnabled: boolean; onLogin: (s: Session) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signingUp = mode === "signup";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (signingUp && password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    setBusy(true);
    try {
      onLogin(await (signingUp ? api.signup(username, password) : api.login(username, password)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          caxxa<span>.</span>
        </div>
        <p className="sub" style={{ margin: "4px 0 18px" }}>
          Controle financeiro pessoal e da empresa
        </p>
        {signupEnabled && (
          <div className="tabs" role="tablist" style={{ marginBottom: 16, alignSelf: "stretch", display: "flex" }}>
            {(["login", "signup"] as const).map((m) => (
              <button
                type="button"
                role="tab"
                aria-selected={mode === m}
                key={m}
                className={mode === m ? "on" : ""}
                style={{ flex: 1 }}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
              >
                {m === "login" ? "Entrar" : "Criar conta"}
              </button>
            ))}
          </div>
        )}
        <label className="field">
          Usuário
          <input
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
            minLength={signingUp ? 3 : undefined}
          />
        </label>
        {signingUp && <span className="sub" style={{ marginTop: 4 }}>3 a 30 caracteres: letras, números, ponto, hífen ou sublinhado</span>}
        <label className="field" style={{ marginTop: 10 }}>
          Senha
          <input
            type="password"
            autoComplete={signingUp ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={signingUp ? 8 : undefined}
          />
        </label>
        {signingUp && (
          <label className="field" style={{ marginTop: 10 }}>
            Confirmar senha
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
          </label>
        )}
        {error && (
          <p className="notice err" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
        <button className="btn primary" style={{ width: "100%", marginTop: 16 }} disabled={busy}>
          {busy ? (signingUp ? "Criando…" : "Entrando…") : signingUp ? "Criar conta e entrar" : "Entrar"}
        </button>
        <p className="sub" style={{ marginTop: 14 }}>
          Seus dados financeiros ficam salvos apenas neste navegador. Cada conta começa com dados de exemplo.
        </p>
      </form>
    </div>
  );
}
