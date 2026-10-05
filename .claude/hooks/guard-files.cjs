// PreToolUse (Edit|Write|NotebookEdit): protect files Claude must not change.
let raw = '';
process.stdin.on('data', (c) => (raw += c)).on('end', () => {
  let f = '';
  try {
    const i = JSON.parse(raw).tool_input || {};
    f = (i.file_path || i.notebook_path || '').replace(/\\/g, '/');
  } catch { process.exit(0); }
  if (/\.env\.example$/i.test(f)) process.exit(0);
  const rules = [
    [/\/bilstein-nl\//i, 'Bilstein NL is read-only reference code; port it into this project instead.'],
    [/(^|\/)\.env(\.[\w-]+)?$/i, '.env files hold secrets; ask the user to edit them (.env.example is fine).'],
    [/\/prisma\/migrations\/[^/]+\/migration\.sql$/i, 'Existing migrations are history; change prisma/schema.prisma and run `npx prisma migrate dev --name <change>`.'],
    [/(^|\/)package-lock\.json$/i, 'The lockfile is managed by npm; run npm install instead.'],
  ];
  for (const [re, why] of rules) {
    if (re.test(f)) {
      process.stderr.write(`Blocked by .claude/hooks/guard-files.cjs: ${why}`);
      process.exit(2);
    }
  }
  process.exit(0);
});
