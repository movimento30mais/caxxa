import { useEffect, useState } from "react";
import { BillStatus, PageHead, dueText } from "../components/ui";
import type { BillAlert, Snapshot } from "../lib/analytics";
import { CATEGORY_NAMES } from "../lib/categories";
import { fmt, fmt0, monthLabel } from "../lib/months";
import { parseAmount } from "../lib/parse";
import { uid } from "../lib/seed";
import { useStore } from "../lib/store";

const notifSupported = typeof window !== "undefined" && "Notification" in window;

/** Notifica pelo navegador, uma vez por dia, as contas atrasadas ou que vencem em até 3 dias. */
export function useBillNotifications(alerts: BillAlert[]) {
  useEffect(() => {
    if (!notifSupported || Notification.permission !== "granted") return;
    const due = alerts.filter((a) => a.status === "atrasada" || (a.status !== "paga" && a.daysLeft <= 3));
    if (!due.length) return;
    const key = `caxxa:notified:${new Date().toISOString().slice(0, 10)}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      /* sem storage: notifica mesmo assim */
    }
    new Notification("Caxxa — contas a vencer", {
      body: due.map((a) => `${a.bill.name}: ${fmt0(a.bill.amount)} (${dueText(a)})`).join("\n"),
    });
  }, [alerts]);
}

export default function Bills({ snap }: { snap: Snapshot }) {
  const { update } = useStore();
  const [perm, setPerm] = useState(notifSupported ? Notification.permission : "denied");
  const [form, setForm] = useState({ name: "", amount: "", dueDay: "10", category: "Moradia" });
  const month = snap.month;
  const open = snap.alerts.filter((a) => a.status !== "paga");
  const paid = snap.alerts.filter((a) => a.status === "paga");

  const togglePaid = (id: string) =>
    update((s) => ({
      ...s,
      bills: s.bills.map((b) => (b.id === id ? { ...b, paid: b.paid.includes(month) ? b.paid.filter((m) => m !== month) : [...b.paid, month] } : b)),
    }));

  function add(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseAmount(form.amount);
    const dueDay = Math.min(31, Math.max(1, Number(form.dueDay) || 1));
    if (!form.name.trim() || !amount) return;
    update((s) => ({ ...s, bills: [...s.bills, { id: uid("b"), name: form.name.trim(), amount: Math.abs(amount), dueDay, category: form.category, paid: [] }] }));
    setForm({ ...form, name: "", amount: "" });
  }

  const row = (a: BillAlert) => (
    <div className="list-item" key={a.bill.id}>
      <input type="checkbox" checked={a.status === "paga"} onChange={() => togglePaid(a.bill.id)} aria-label={`Marcar ${a.bill.name} como paga`} />
      <div className="grow">
        <div className="ellipsis">{a.bill.name}</div>
        <div className="sub">
          {a.bill.category} · {dueText(a)}
        </div>
      </div>
      <BillStatus alert={a} />
      <span style={{ width: 110, textAlign: "right" }}>{fmt(a.bill.amount)}</span>
      <button className="btn ghost small" title="Excluir" onClick={() => confirm(`Excluir "${a.bill.name}"?`) && update((s) => ({ ...s, bills: s.bills.filter((b) => b.id !== a.bill.id) }))}>
        ✕
      </button>
    </div>
  );

  return (
    <>
      <PageHead title="Contas a pagar" sub={`Vencimentos recorrentes de ${monthLabel(month)} com alertas.`}>
        {notifSupported && perm !== "granted" && (
          <button className="btn" disabled={perm === "denied"} onClick={() => Notification.requestPermission().then(setPerm)}>
            {perm === "denied" ? "Notificações bloqueadas no navegador" : "🔔 Ativar alertas no navegador"}
          </button>
        )}
        {perm === "granted" && <span className="chip baixa">🔔 alertas ativos</span>}
      </PageHead>

      <div className="grid g2">
        <div className="card">
          <div className="card-head">
            <h2>Em aberto</h2>
            <span className="sub">{fmt0(open.reduce((s, a) => s + a.bill.amount, 0))}</span>
          </div>
          <div className="list">{open.length ? open.map(row) : <div className="empty">Nada em aberto 🎉</div>}</div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Pagas no mês</h2>
            <span className="sub">{fmt0(paid.reduce((s, a) => s + a.bill.amount, 0))}</span>
          </div>
          <div className="list">{paid.length ? paid.map(row) : <div className="empty">Nenhuma conta marcada como paga.</div>}</div>
        </div>
      </div>

      <form className="card" onSubmit={add} style={{ marginTop: 16 }}>
        <h2>Nova conta recorrente</h2>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ flex: 2, minWidth: 180 }}>
            Nome
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="field">
            Valor
            <input type="text" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required style={{ width: 120 }} />
          </label>
          <label className="field">
            Dia do vencimento
            <input type="number" min={1} max={31} value={form.dueDay} onChange={(e) => setForm({ ...form, dueDay: e.target.value })} style={{ width: 90 }} />
          </label>
          <label className="field">
            Categoria
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORY_NAMES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <button className="btn primary">Adicionar</button>
        </div>
      </form>
    </>
  );
}
