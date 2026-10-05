// Prototype-only colour theme picker. Themes are defined in styles/tokens.css.
(function () {
  const KEY = 'fitfinder-theme';
  const select = document.getElementById('theme-select');
  let theme = 'graphite';
  try { theme = localStorage.getItem(KEY) || theme; } catch (e) {}
  document.documentElement.dataset.theme = theme;
  if (select) {
    select.value = theme;
    select.addEventListener('change', () => {
      document.documentElement.dataset.theme = select.value;
      try { localStorage.setItem(KEY, select.value); } catch (e) {}
    });
  }
})();
