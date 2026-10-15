// SessionStart: remind Claude where the project stands, so every session starts from current state.
const fs = require('fs'), path = require('path');
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const p = path.join(root, '.claude', 'PROGRESS.md');
const lines = ['SpareFit: app built (M1–M11). Specs in .claude/specs/, prototype in .claude/design/, workflow in README.md; .claude/archive/ is history only.',
  'Workflow skills: /check-spec, /verify-shopify, /pre-submit. Subagents: spec-reviewer, shopify-verifier, code-reviewer.'];
if (fs.existsSync(p)) lines.push('Current progress (.claude/PROGRESS.md):\n' + fs.readFileSync(p, 'utf8').slice(0, 3000));
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } }));
