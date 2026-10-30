import { useEffect, useState, type ReactNode } from "react";
import { api, type Session } from "./lib/api";

/** Mostra o login quando o servidor exige e entrega a sessão para o app. */
export function AuthGate({ children }: { children: (session: Session, logout: () => void) => ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    api.me().then(setSession, (e: Error) => {
      // Sem servidor (ex.: só o front em dev) segue como usuário local.
      setSession(/Faça login/.test(e.message) ? null : { user: "local", authEnabled: false });
    });
  }, []);

  if (session === undefined) return <div className="login-wrap" aria-busy="true" />;
  if (session === null) return <Login onLogin={setSession} />;
  const logout = () => {
    void api.logout().finally(() => setSession(null));
  };
  return <>{children(session, logout)}</>;
}

function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await api.login(username, password));
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
        <label className="field">
          Usuário
          <input type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </label>
        <label className="field" style={{ marginTop: 10 }}>
          Senha
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <p className="notice err" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
        <button className="btn primary" style={{ width: "100%", marginTop: 16 }} disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
        <p className="sub" style={{ marginTop: 14 }}>
          Seus dados ficam salvos apenas neste navegador. Cada usuário começa com dados de exemplo.
        </p>
      </form>
    </div>
  );
}
