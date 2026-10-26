---
name: check-spec
description: Check that an implemented SpareFit screen (or all of them) still matches its spec in .claude/specs/, the UI rules (specs/ui-rules.md) and the rules in CLAUDE.md. Use after UI changes, when the user asks "does X match the design", or before a larger change is done.
argument-hint: "[screen name, e.g. search-setup | storefront | all]"
---

# Check a screen against its spec

Target: `$ARGUMENTS` (a spec name from `.claude/specs/`, or `all`; if empty, use the screens touched by `git diff`).

1. Map each target to its route and extension files (see `app/routes/` and `extensions/`):
   - `dashboard` → `app/routes/app._index.tsx`
   - `fitment-data` → `app/routes/app.filter-data.tsx`
   - `storefront` → `app/routes/app.storefront.tsx` and `extensions/sparefit-theme/**`
   - …
   If a route doesn't exist yet, report "not built" for that screen.
2. Launch one `spec-reviewer` subagent per screen, in parallel (one message, several Agent calls). Give each agent:
   - the spec path and `.claude/specs/ui-rules.md`
   - the implementation files
3. Merge the reports into one table:

   | Screen | Verdict | Blockers | Text mismatches | Spec updates needed |
   | --- | --- | --- | --- | --- |

4. Ask the user before changing code or specs. Some differences may be intended. If the user confirms the code is right, update the spec so the two match again.
