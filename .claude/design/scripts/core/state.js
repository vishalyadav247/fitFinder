// Prototype state. Saved to localStorage so edits survive a reload. In the real app this lives in the database.
/* ---------- state (kept in this browser so edits survive a reload) ---------- */
const KEY = 'fitfinder-prototype-v18';
const freshState = () => ({ screen:'onboarding', setup:null, choice:'automotive', step:1, mode:'upsert', picks:{}, searched:false });
let state;
try { state = JSON.parse(localStorage.getItem(KEY)) || freshState(); } catch (e) { state = freshState(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };
const setup = () => state.setup;
const tpl = () => TEMPLATES[state.setup.type];
