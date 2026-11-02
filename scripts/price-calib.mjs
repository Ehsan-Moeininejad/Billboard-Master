// Price level from an agency rate card (data/agency/*.json), used to bring the other listings to today's prices.
//
// The open listings (Rasamap) carry prices from an older crawl — on the same highway they are ~20–40× below what
// agencies quote in 1405. An agency's rate card is current, so it sets the level:
//   log(price) = a + b·log(face m²) + type effect + corridor effect      (least squares, small ridge)
// fitted on the rate card. Every other listing then gets
//   estimate = model^0.5 × (own old price × k)^0.5
// where k = median(model ÷ old price): the level comes from the rate card, while the listing's own old price
// still moves it up or down a little relative to its neighbours. Listings without a price get the model alone.

const TYPES = ['bridge', 'poster', 'digital', 'rooftop']; // bulletin is the base
export const DEFAULT_M2 = { bulletin: 48, bridge: 45, poster: 18, digital: 32, rooftop: 90 };

function solve(A, y, ridge = 0.3) {
  const n = A[0].length, M = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (let r = 0; r < A.length; r++) for (let i = 0; i < n; i++) { M[i][n] += A[r][i] * y[r]; for (let j = 0; j < n; j++) M[i][j] += A[r][i] * A[r][j]; }
  for (let i = 1; i < n; i++) M[i][i] += ridge; // keep the intercept free
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

/**
 * @param rows  [{ price, m2, type, corridor }]  (corridor: highway key or 'street')
 * @returns model with predict(row)
 */
export function fitRateCard(rows, { recenter = false } = {}) {
  const ok = rows.filter(r => r.price > 0);
  if (ok.length < 12) return null;
  const count = {}; ok.forEach(r => { count[r.corridor] = (count[r.corridor] || 0) + 1; });
  const CORR = Object.keys(count).filter(c => c !== 'street' && count[c] >= 3);
  const feat = r => [1, Math.log(r.m2 || DEFAULT_M2[r.type] || 40), ...TYPES.map(t => (r.type === t ? 1 : 0)), r.corridor === 'street' ? 1 : 0,
    ...CORR.map(c => (r.corridor === c ? 1 : 0))];
  const beta = solve(ok.map(feat), ok.map(r => Math.log(r.price)));
  // the face-size elasticity is kept in a sane band (bigger faces cost more, but not proportionally)
  const raw = beta[1];
  beta[1] = Math.max(0.2, Math.min(0.9, beta[1]));
  // after clamping the size elasticity the other terms no longer fit: refit them with the elasticity held fixed
  // (used for the provincial cards, where small bridge faces on main squares cost more than large boards elsewhere)
  if (recenter && beta[1] !== raw) {
    const rest = solve(ok.map(r => feat(r).filter((_, i) => i !== 1)), ok.map(r => Math.log(r.price) - beta[1] * Math.log(r.m2 || DEFAULT_M2[r.type] || 40)));
    rest.forEach((v, j) => { beta[j < 1 ? j : j + 1] = v; });
  }
  const predict = r => Math.exp(feat(r).reduce((s, v, i) => s + v * beta[i], 0));
  const resid = ok.map(r => Math.log(r.price) - Math.log(predict(r)));
  const rmse = Math.sqrt(resid.reduce((s, v) => s + v * v, 0) / resid.length);
  return { predict, beta, corridors: CORR, n: ok.length, rmse, sizeElasticity: +raw.toFixed(2) };
}

export const median = v => { const s = v.filter(Number.isFinite).sort((a, b) => a - b), m = s.length >> 1; return !s.length ? null : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
