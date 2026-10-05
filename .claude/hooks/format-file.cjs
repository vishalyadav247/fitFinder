// PostToolUse (Edit|Write): prettier + eslint --fix on the changed file.
// No-op until the app is scaffolded (no node_modules) and for files the tools don't handle.
// Lint errors that remain are fed back to Claude (exit 2) so it fixes them in the same turn.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
let raw = '';
process.stdin.on('data', (c) => (raw += c)).on('end', () => {
  let f = '';
  try { const j = JSON.parse(raw); f = j.tool_input?.file_path || j.tool_response?.filePath || ''; } catch { process.exit(0); }
  if (!f || !fs.existsSync(f)) process.exit(0);
  const norm = f.replace(/\\/g, '/');
  if (/\/(\.claude|node_modules|build|\.shopify|\.react-router)\//.test(norm)) process.exit(0); // docs, prototype, generated
  const ext = path.extname(f).toLowerCase();
  const JS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
  if (![...JS, '.css', '.json', '.md', '.graphql', '.prisma'].includes(ext)) process.exit(0);

  // nearest folder with node_modules (project root or an extension folder)
  let dir = path.dirname(f), root = null;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'node_modules'))) { root = dir; break; }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (!root) process.exit(0);

  const win = process.platform === 'win32';
  const bin = (n) => { const p = path.join(root, 'node_modules', '.bin', n + (win ? '.cmd' : '')); return fs.existsSync(p) ? p : null; };
  const q = (s) => (win ? `"${s}"` : s);
  const run = (b, args) => spawnSync(q(b), args.map(q), { cwd: root, encoding: 'utf8', shell: win, timeout: 60000 });

  if (ext === '.prisma') { const p = bin('prisma'); if (p) run(p, ['format', '--schema', f]); process.exit(0); }
  const prettier = bin('prettier');
  if (prettier) run(prettier, ['--write', '--log-level', 'warn', f]);
  const eslint = bin('eslint');
  if (eslint && JS.includes(ext)) {
    const r = run(eslint, ['--fix', '--no-warn-ignored', f]);
    if (r.status === 1 && (r.stdout || '').trim()) {
      process.stderr.write(`ESLint errors remain in ${f}:\n${r.stdout.trim().slice(0, 4000)}`);
      process.exit(2);
    }
  }
  process.exit(0);
});
