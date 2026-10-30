import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthGate } from "./Auth";
import { StoreProvider } from "./lib/store";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate>
      {(session, logout) => (
        // key: trocar de usuário recarrega os dados daquele usuário.
        <StoreProvider key={session.user} user={session.user}>
          <App session={session} onLogout={logout} />
        </StoreProvider>
      )}
    </AuthGate>
  </StrictMode>,
);
