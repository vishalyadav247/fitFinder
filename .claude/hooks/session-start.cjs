// SessionStart: remind Claude where the build stands, so every session starts from the plan.
const fs = require('fs'), path = require('path');
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const p = path.join(root, '.claude', 'PROGRESS.md');
const lines = ['FitFinder: follow .claude/BUILD-PLAN.md milestone by milestone; specs in .claude/specs/, prototype in .claude/design/.',
  'Workflow skills: /build-milestone, /check-spec, /verify-shopify, /pre-submit. Subagents: spec-reviewer, shopify-verifier, code-reviewer.'];
if (fs.existsSync(p)) lines.push('Current progress (.claude/PROGRESS.md):\n' + fs.readFileSync(p, 'utf8').slice(0, 3000));
else lines.push('No .claude/PROGRESS.md yet — nothing has been built. Start with M1.');
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } }));
