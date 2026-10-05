// App navigation. In the real app this is the App Bridge <s-app-nav> menu in the Shopify admin sidebar.
/* ---------- navigation ---------- */
const NAV = [
  ['home','Dashboard','home','t-indigo'], ['fields','Search setup','fields','t-violet'], ['data','Filter data','table','t-teal'],
  ['store','Storefront','store','t-pink'], ['mapping','Product mapping','link','t-amber'],
  ['settings','Settings','settings','t-slate'], ['plans','Plans','plans','t-green']
];
function renderNav() {
  const off = state.screen === 'onboarding';
  document.getElementById('side').hidden = off;
  document.getElementById('mnav').hidden = off;
  document.querySelector('.shell').style.gridTemplateColumns = off ? 'minmax(0,1fr)' : '';
  document.getElementById('nav').innerHTML = NAV.map(([k, label, ic, tile]) =>
    `<button class="nav" data-go="${k}"${state.screen === k ? ' aria-current="page"' : ''}><span class="nav-ico">${svg(ic, 16)}</span>${label}</button>`).join('');
  document.getElementById('mnav').innerHTML = NAV.map(([k, label]) =>
    `<button data-go="${k}"${state.screen === k ? ' aria-current="page"' : ''}>${label}</button>`).join('');
}
