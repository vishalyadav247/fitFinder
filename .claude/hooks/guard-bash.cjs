// PreToolUse (Bash|PowerShell): block commands that publish, deploy or destroy.
// Exit 2 + stderr = blocked; Claude sees the reason. The user can still run it with `! <command>`.
let raw = '';
process.stdin.on('data', (c) => (raw += c)).on('end', () => {
  let cmd = '';
  try { cmd = JSON.parse(raw).tool_input?.command || ''; } catch { process.exit(0); }
  const rules = [
    [/\bgit\s+push\b/i, 'git push: never push to a remote unless the user asks.'],
    [/\bshopify\s+app\s+(deploy|release)\b/i, 'shopify app deploy/release publishes a new app version to merchants.'],
    [/\b(npm|pnpm|yarn)\s+(run\s+)?(deploy|release)\b/i, 'the deploy script runs shopify app deploy.'],
    [/\bshopify\s+theme\s+(push|publish)\b/i, 'shopify theme push/publish changes a live theme.'],
    [/\bprisma\s+migrate\s+reset\b/i, 'prisma migrate reset wipes the database.'],
    [/\bprisma\s+db\s+push\b.*--accept-data-loss/i, 'prisma db push --accept-data-loss can drop data.'],
    [/\b(npm|pnpm|yarn)\s+publish\b/i, 'publishing a package.'],
    [/\brm\s+-[a-z]*r[a-z]*\s+(\/|~|\.|\.\/|\*|\.claude\/?)(\s|$)/i, 'recursive delete of a root, home, project or .claude directory.'],
    [/\bRemove-Item\b.*-Recurse.*\s(\.|\*|\.claude|[A-Z]:\\?)(\s|$)/i, 'recursive delete of the project, .claude or a drive.'],
  ];
  // Bilstein NL is read-only reference code: block anything that writes, moves or deletes there.
  if (/bilstein-nl/i.test(cmd) && /(\brm\b|\bmv\b|\bcp\b.*bilstein-nl\S*\s*$|sed\s+-i|Remove-Item|Move-Item|Set-Content|Out-File|>)/i.test(cmd)) {
    rules.unshift([/[\s\S]/, 'Bilstein NL is read-only reference code; port it into this project instead.']);
  }
  for (const [re, why] of rules) {
    if (re.test(cmd)) {
      process.stderr.write(`Blocked by .claude/hooks/guard-bash.cjs: ${why}\nIf the user really wants this, ask them to run it themselves with "! <command>".`);
      process.exit(2);
    }
  }
  process.exit(0);
});
