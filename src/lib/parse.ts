/** Aceita "1.234,56", "-2000" ou expressões simples como na planilha ("=-2337,5-780", "-400*4"). */
export function parseAmount(raw: string): number | null {
  let s = raw.trim().replace(/^=/, "").replace(/\s/g, "");
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\.(?=\d{3}(\D|$))/g, "").replace(/,/g, ".");
  // Só dígitos e operadores chegam ao avaliador.
  if (!/^[\d+\-*/().]+$/.test(s)) return null;
  try {
    const v = Function(`"use strict";return (${s})`)() as unknown;
    return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  } catch {
    return null;
  }
}
