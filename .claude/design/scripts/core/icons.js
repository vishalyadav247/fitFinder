// Icons, HTML escaping and id helpers shared by every screen.
/* ---------- icons (for colourful tiles; Polaris icons are used inside components) ---------- */
const I = {
  arrow:'<path d="M4 10h12M11 5l5 5-5 5"/>',
  left:'<path d="M12 5l-5 5 5 5"/>', right:'<path d="M8 5l5 5-5 5"/>', up:'<path d="M6 12l4-4 4 4"/>', down:'<path d="M6 8l4 4 4-4"/>',
  home:'<path d="M3 8.5 10 3l7 5.5V17H3z"/>', fields:'<rect x="3" y="4" width="14" height="4" rx="1.5"/><rect x="3" y="12" width="14" height="4" rx="1.5"/>',
  table:'<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M3 8h14M8 8v8"/>', upload:'<path d="M10 13V4M6.5 7.5 10 4l3.5 3.5"/><path d="M3.5 13v3.5h13V13"/>',
  link:'<path d="M8.5 11.5l3-3M7.5 9 5.5 11a2.5 2.5 0 003.5 3.5l2-2M12.5 11l2-2A2.5 2.5 0 0011 5.5L9 7.5"/>', store:'<path d="M3 8l1.5-4h11L17 8M4 8v9h12V8M3 8h14"/>',
  settings:'<circle cx="10" cy="10" r="2.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
  plans:'<rect x="3" y="5" width="14" height="10" rx="2"/><path d="M3 8.5h14"/>',
  car:'<path d="M3 13v-2.5L5 6h10l2 4.5V13z"/><circle cx="6.5" cy="13.5" r="1.5"/><circle cx="13.5" cy="13.5" r="1.5"/>',
  phone:'<rect x="6" y="2.5" width="8" height="15" rx="2"/><path d="M9 15h2"/>',
  beauty:'<rect x="7" y="8" width="6" height="9.5" rx="1.5"/><path d="M8 8V5.5l4-3V8"/>',
  search:'<circle cx="9" cy="9" r="5.5"/><path d="M13.2 13.2 17 17"/>', rows:'<path d="M4 5h12M4 10h12M4 15h12"/>',
  warn:'<path d="M10 3 18 17H2z"/><path d="M10 8v4M10 14.5v.5"/>', check:'<path d="M5 10.5l3 3L15 7"/>',
  spark:'<path d="M10 2v4M10 14v4M2 10h4M14 10h4M4.5 4.5l2.5 2.5M13 13l2.5 2.5M4.5 15.5 7 13M13 7l2.5-2.5"/>',
  star:'<path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/>',
  heart:'<path d="M10 16.5S3 12.4 3 7.6A3.6 3.6 0 0110 5.9a3.6 3.6 0 017 1.7c0 4.8-7 8.9-7 8.9z"/>',
  bookmark:'<path d="M5.5 3h9v14l-4.5-3.2L5.5 17z"/>',
  clock:'<circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 2"/>',
  trash:'<path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6M8.5 9v5M11.5 9v5"/>',
  close:'<path d="M5 5l10 10M15 5 5 15"/>'
};
const svg = (n, s = 16, w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
const NOW = 2026;
let uid = 1000 + Math.floor(Math.random() * 1000);
const nid = (p) => p + (++uid);
