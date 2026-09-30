export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Sumy faktury z uwzględnieniem rabatu procentowego. */
export function invoiceTotals(items, discountPct = 0) {
  let net = 0, vat = 0;
  const f = 1 - (Number(discountPct) || 0) / 100;
  for (const it of items) {
    const n = round2(it.qty * it.unit_net * f);
    net += n;
    vat += round2((n * (it.vat ?? 23)) / 100);
  }
  net = round2(net); vat = round2(vat);
  return { net, vat, gross: round2(net + vat) };
}
