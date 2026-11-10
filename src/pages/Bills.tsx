import { useEffect, useMemo, useState } from "react";
import { BillStatus, PageHead, dueText } from "../components/ui";
import { billAlerts, type BillAlert, type Snapshot } from "../lib/analytics";
import { billsForMonth, payBill, unpayBill } from "../lib/bills";
import { num } from "../components/FlowGrid";
import { CATEGORY_NAMES } from "../lib/categories";
import { fmt, fmt0, monthLabel } from "../lib/months";
import { parseAmount } from "../lib/parse";
import { uid } from "../lib/seed";
import { useStore } from "../lib/store";
import type { Bill, LineBill } from "../lib/types";

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

const SOURCE_LABEL = { pessoal: "Fluxo pessoal", empresa: "Empresa", manual: "Avulsa" } as const;

export default function Bills({ snap }: { snap: Snapshot }) {
  const { state, update } = useStore();
  const [perm, setPerm] = useState(notifSupported ? Notification.permission : "denied");
  const [form, setForm] = useState({ name: "", amount: "", dueDay: "10", category: "Moradia" });
  const months = useMemo(() => {
    const set = new Set([snap.month, ...snap.flow.map((m) => m.month)]);
    return [...set].sort();
  }, [snap.flow, snap.month]);
  const [month, setMonth] = useState(snap.month);
  const { visible, hidden } = billsForMonth(state, month, snap.company);
  const alerts = billAlerts(visible, new Date(), month);
  const open = alerts.filter((a) => a.status !== "paga");
  const paid = alerts.filter((a) => a.status === "paga");

  /** Altera a conta: as avulsas em bills; as automáticas nos ajustes da linha (lineBills). */
  const patch = (b: Bill, p: Partial<LineBill> & { amount?: number }) =>
    update((s) => {
      if (b.source === "manual" || !b.lineId) {
        return { ...s, bills: s.bills.map((x) => (x.id === b.id ? { ...x, ...p, name: p.name ?? x.name } : x)) };
      }
      const cur = s.lineBills?.[b.lineId] ?? { dueDay: b.dueDay, paid: b.paid };
      const { amount: _, ...lb } = p;
      return { ...s, lineBills: { ...s.lineBills, [b.lineId]: { ...cur, ...lb } } };
    });

  /**
   * Marcar como paga: pergunta o valor pago (já preenchido com o previsto), registra o pagamento,
   * cria o lançamento e tira a despesa das pendentes do fluxo. Desmarcar desfaz tudo.
   */
  const togglePaid = (b: Bill) => {
    if (b.paid.includes(month)) {
      update((s) => unpayBill(s, b, month));
      return;
    }
    let amount = b.amount;
    if (!b.computed) {
      const raw = prompt(`Valor pago de "${b.name}" (${monthLabel(month)}):`, num.format(b.amount));
      if (raw === null) return;
      const v = parseAmount(raw);
      if (!v) return;
      amount = Math.abs(v);
    }
    update((s) => payBill(s, b, month, amount));
  };

  /** Valor de conta automática = valor da despesa no fluxo; editar aqui atualiza o fluxo daquele mês. */
  const setAmount = (b: Bill, amount: number) =>
    update((s) => {
      if (b.source === "manual" || !b.lineId) return { ...s, bills: s.bills.map((x) => (x.id === b.id ? { ...x, amount } : x)) };
      const setVal = <T extends { id: string; values: Record<string, number> }>(ls: T[]) =>
        ls.map((l) => (l.id === b.lineId ? { ...l, values: { ...l.values, [month]: -Math.abs(amount) } } : l));
      return b.source === "empresa" ? { ...s, company: { ...s.company, lines: setVal(s.company.lines) } } : { ...s, lines: setVal(s.lines) };
    });

  function add(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseAmount(form.amount);
    const dueDay = Math.min(31, Math.max(1, Number(form.dueDay) || 1));
    if (!form.name.trim() || !amount) return;
    update((s) => ({ ...s, bills: [...s.bills, { id: uid("b"), name: form.name.trim(), amount: Math.abs(amount), dueDay, category: form.category, paid: [] }] }));
    setForm({ ...form, name: "", amount: "" });
  }

  const row = (a: BillAlert) => {
    const b = a.bill;
    const auto = b.source !== "manual";
    return (
      <div className="list-item bill-item" key={`${b.id}:${month}`}>
        <input type="checkbox" className="bill-check" checked={a.status === "paga"} onChange={() => togglePaid(b)} aria-label={`Marcar ${b.name} como paga`} />
        <div className="grow bill-main">
          <input
            key={b.name}
            className="bill-name"
            defaultValue={b.name}
            aria-label="Nome da conta"
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== b.name && patch(b, { name: e.target.value.trim() })}
          />
          <div className="sub bill-meta">
            <span className={`chip ${b.source === "empresa" ? "media" : b.source === "pessoal" ? "neutral" : "baixa"}`}>{SOURCE_LABEL[b.source ?? "manual"]}</span>
            <label className="bill-day">
              dia
              <input
                key={b.dueDay}
                type="number"
                min={1}
                max={31}
                inputMode="numeric"
                defaultValue={b.dueDay}
                aria-label={`Dia de vencimento de ${b.name}`}
                onBlur={(e) => {
                  const d = Math.min(31, Math.max(1, Number(e.target.value) || b.dueDay));
                  e.target.value = String(d);
                  if (d !== b.dueDay) patch(b, { dueDay: d });
                }}
              />
            </label>
            <span>{dueText(a)}</span>
          </div>
        </div>
        <BillStatus alert={a} />
        {b.paid.includes(month) ? (
          <span className="bill-amount cell-paid" title={b.payments?.[month] ? `Pago em ${b.payments[month].date.split("-").reverse().join("/")}` : "Paga"}>
            ✓ {num.format(b.payments?.[month]?.amount ?? b.amount)}
          </span>
        ) : b.computed ? (
          <span className="bill-amount computed-value" title="Calculado como % do faturamento (edite na Empresa)">
            {fmt(b.amount)}
          </span>
        ) : (
          <input
            key={b.amount}
            className="bill-amount"
            inputMode="decimal"
            defaultValue={fmt(b.amount).replace("R$", "").trim()}
            aria-label={`Valor de ${b.name}`}
            title={auto ? "Alterar aqui também altera o valor no fluxo deste mês" : undefined}
            onBlur={(e) => {
              const v = parseAmount(e.target.value);
              if (v === null || !v) e.target.value = fmt(b.amount).replace("R$", "").trim();
              else if (Math.abs(v) !== b.amount) setAmount(b, Math.abs(v));
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        )}
        {auto ? (
          <button className="btn ghost small" title="Não é uma conta a pagar: ocultar da lista" aria-label={`Ocultar ${b.name}`} onClick={() => patch(b, { hidden: true })}>
            ⊘
          </button>
        ) : (
          <button className="btn ghost small" title="Excluir" aria-label={`Excluir ${b.name}`} onClick={() => confirm(`Excluir "${b.name}"?`) && update((s) => ({ ...s, bills: s.bills.filter((x) => x.id !== b.id) }))}>
            ✕
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <PageHead title="Contas a pagar" sub="Geradas automaticamente das despesas do fluxo pessoal e da empresa. Edite nome, vencimento e valor.">
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mês">
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
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
            <h2>Em aberto · {monthLabel(month)}</h2>
            <span className="sub">{fmt0(open.reduce((s, a) => s + a.bill.amount, 0))}</span>
          </div>
          <div className="list">{open.length ? open.map(row) : <div className="empty">Nada em aberto 🎉</div>}</div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Pagas no mês</h2>
            <span className="sub">{fmt0(paid.reduce((s, a) => s + (a.bill.payments?.[month]?.amount ?? a.bill.amount), 0))}</span>
          </div>
          <div className="list">{paid.length ? paid.map(row) : <div className="empty">Nenhuma conta marcada como paga.</div>}</div>
        </div>
      </div>

      {hidden.length > 0 && (
        <details className="card" style={{ marginTop: 16 }}>
          <summary>
            <b>Despesas que não são contas ({hidden.length})</b> <span className="sub">— ocultas da lista; toque para mostrar de novo</span>
          </summary>
          <div className="list" style={{ marginTop: 8 }}>
            {hidden.map((b) => (
              <div className="list-item" key={b.id}>
                <div className="grow">
                  <div className="ellipsis">{b.name}</div>
                  <div className="sub">
                    {SOURCE_LABEL[b.source ?? "manual"]} · {fmt(b.amount)}
                  </div>
                </div>
                <button className="btn small" onClick={() => patch(b, { hidden: false })}>
                  Mostrar
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      <form className="card" onSubmit={add} style={{ marginTop: 16 }}>
        <h2>Nova conta avulsa</h2>
        <p className="sub" style={{ marginBottom: 10 }}>
          Para contas que não estão no fluxo. As despesas do fluxo já entram sozinhas.
        </p>
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
