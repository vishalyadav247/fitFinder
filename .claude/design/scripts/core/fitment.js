// Fitment logic: year ranges and cascading dropdown options. The real app runs this on the server.
/* ---------- fitment helpers ---------- */
function years(range) {
  const [a, b] = String(range || '').split('-');
  const from = parseInt(a, 10), to = b ? parseInt(b, 10) : NOW;
  if (!from) return [];
  const out = []; for (let y = Math.max(from, to); y >= from; y--) out.push(String(y)); return out;
}
const showValue = (f, val) => f.type === 'years' ? (val ? (String(val).endsWith('-') ? val.slice(0, -1) + ' – now' : String(val).replace('-', ' – ')) : '—') : (val || '—');
function rowMatches(sp, row, upto) {
  for (let i = 0; i < upto; i++) {
    const f = sp.fields[i], pick = state.picks[f.id];
    if (!pick) continue;
    if (f.type === 'years') { if (!years(row.v[f.id]).includes(pick)) return false; }
    else if (row.v[f.id] !== pick) return false;
  }
  return true;
}
function optionsFor(sp, i) {
  const f = sp.fields[i], set = new Set();
  sp.rows.filter((r) => rowMatches(sp, r, i)).forEach((r) => {
    if (f.type === 'years') years(r.v[f.id]).forEach((y) => set.add(y));
    else if (r.v[f.id]) set.add(r.v[f.id]);
  });
  const list = [...set];
  return f.type === 'years' ? list.sort((a, b) => b - a) : list.sort((a, b) => a.localeCompare(b));
}
