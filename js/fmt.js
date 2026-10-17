// Formatting helpers — Persian text, Latin digits.
const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export const num = v => (v == null || !Number.isFinite(v)) ? '—' : nf.format(Math.round(v));
export const num1 = v => (v == null || !Number.isFinite(v)) ? '—' : nf1.format(v);

/** 1,234,567 → «1.2 میلیون» ; 85,300 → «85 هزار» */
export function compact(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `${nf1.format(v / 1e9)} میلیارد`;
  if (a >= 1e6) return `${nf1.format(v / 1e6)} میلیون`;
  if (a >= 1e4) return `${nf.format(v / 1e3)} هزار`;
  if (a >= 1e3) return `${nf1.format(v / 1e3)} هزار`;
  return nf.format(v);
}
/** compact with separate value/unit for KPI layout */
export function compactParts(v) {
  const s = compact(v);
  const i = s.indexOf(' ');
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
}
export const toman = v => v == null ? '—' : `${compact(v)} تومان`;
export const hourLabel = h => `${String(h).padStart(2, '0')}:00`;
export const hourRange = hs => {
  if (!hs?.length) return '—';
  // group consecutive hours
  const out = []; let s = hs[0], p = hs[0];
  for (let i = 1; i <= hs.length; i++) {
    if (hs[i] === p + 1) { p = hs[i]; continue; }
    out.push(s === p ? `${s}` : `${s} تا ${p + 1}`);
    s = p = hs[i];
  }
  return out.join(' و ');
};

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Parse user number input that may contain Persian/Arabic digits and separators. */
export function parseNum(s) {
  if (s == null) return null;
  const t = String(s)
    .replace(/[۰-۹]/g, d => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)])
    .replace(/[٠-٩]/g, d => '0123456789'['٠١٢٣٤٥٦٧٨٩'.indexOf(d)])
    .replace(/[,،٬\s]/g, '');
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function scoreLabel(s) {
  if (s >= 80) return 'عالی';
  if (s >= 65) return 'خیلی خوب';
  if (s >= 50) return 'خوب';
  if (s >= 35) return 'متوسط';
  return 'ضعیف';
}
