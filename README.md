# proof-of-work

> Verification suite that catches false completeness in AI coding assistants. Hard-gates completion claims, scores evidence, and grades quality.

---

## What It Does

AI coding assistants often claim tasks are "done" when they aren't. They skip error handling, leave stubs, break existing tests, or hallucinate that a build succeeded. **proof-of-work** intercepts these claims and forces real verification:

- **Rewrite guard** — flags when an agent is about to overwrite a file with more than N% new content without justification
- **Band-aid guard** — detects when edits are masking a problem rather than solving it
- **Claim capture** — tracks every "done", "completed", "fixed" claim made during a session
- **Completion gate** — at session end, scores all evidence and blocks the Stop event if the threshold isn't met
- **Code graph** — maintains a SQLite-backed dependency graph so impact radius is always known

---

## Installation

Place this plugin in your project's local plugin directory:

```bash
mkdir -p .claude/plugins/local
cp -r proof-of-work .claude/plugins/local/proof-of-work
```

Register the hooks by merging `hooks/hooks.json` into your `.claude/settings.json` (or `settings.local.json`):

```json
{
  "hooks": { ... }  // contents of hooks/hooks.json
}
```

---

## Configuration

Create `.claude/proof-of-work.local.md` in your project root with YAML frontmatter:

```markdown
---
verificationLevel: git
rewriteThreshold: 60
autoVerify: true
bandAidMode: detect
buildCommand: npm run build
testCommand: npm test
---

Any notes about your project-specific rules go here.
```

### Config Options

| Key | Default | Description |
|-----|---------|-------------|
| `verificationLevel` | `git` | How deeply to verify: `git`, `build`, or `full` |
| `rewriteThreshold` | `60` | % of new lines in a Write that triggers the rewrite guard |
| `autoVerify` | `true` | Run verification automatically on Stop |
| `bandAidMode` | `detect` | `detect` warns, `block` prevents the edit |
| `buildCommand` | `null` | Shell command to verify build passes |
| `testCommand` | `null` | Shell command to run tests |

---

## The `/prove` Commands

### `/prove`
Run a full verification pass right now. Scores all evidence gathered in the session and outputs the Evidence Report Card.

### `/prove init`
Initialize proof-of-work in a new project. Creates `.claude/proof-of-work.local.md` with default config and copies `templates/quality-contract.md` to `.claude/quality-contract.md`.

### `/prove rebuild`
Force a full rebuild of the code graph from scratch. Use this after large refactors or when the graph is stale.

---

## The Evidence Report Card

At the end of every session (or on `/prove`), the completion gate outputs a report card:

```
┌─ PROOF OF WORK ──────────────────────────────────────┐
│                                                      │
│  VERDICT: NEEDS REVIEW          Score: 68/100        │
│                                                      │
│  Claims verified:    4/5  ⚠️                         │
│  Scope drift:        None  ✅                        │
│  Build:              Pass  ✅                        │
│  Tests:              N/A                             │
│  Reality grade:      C+                              │
│  Band-aids:          1 found                         │
└──────────────────────────────────────────────────────┘
```

---

## Scoring

Each component contributes to the 100-point score. If a component is N/A (e.g., no test command configured), its points redistribute proportionally among the remaining components.

| Component | Points | What it measures |
|-----------|--------|-----------------|
| Claims verified | 30 | Ratio of agent completion claims backed by real evidence |
| Scope drift | 20 | Files changed outside the stated task scope |
| Build | 15 | Build command exits 0 |
| Tests | 15 | Test command exits 0, no regressions |
| Reality grade | 10 | Quality contract checklist completion rate |
| Band-aids | 10 | Absence of detected patch-over patterns |

### Verdicts

| Score | Verdict |
|-------|---------|
| 80 – 100 | **VERIFIED** — safe to ship |
| 50 – 79 | **NEEDS REVIEW** — human should spot-check |
| 0 – 49 | **FAILED** — agent did not complete the task |

---

## Project Structure

```
proof-of-work/
├── .claude-plugin/
│   └── plugin.json          # Plugin manifest
├── hooks/
│   ├── hooks.json           # Hook + MCP server registrations
│   ├── rewrite-guard.mjs    # PreToolUse: Write — detects large rewrites
│   ├── band-aid-guard.mjs   # PreToolUse: Edit|Write — detects patches over problems
│   ├── claim-capture.mjs    # PostToolUse: Bash|Write|Edit — captures completion claims
│   ├── graph-update.mjs     # PostToolUse: Edit|Write — updates code graph
│   └── completion-gate.mjs  # Stop — scores evidence, outputs report card
├── graph/
│   └── dist/
│       └── server.js        # MCP server for pow-graph
├── lib/
│   └── config.mjs           # Config reader with defaults
├── templates/
│   └── quality-contract.md  # Checklist template for quality standards
└── README.md
```

---

## License

MIT — Copyright 2026 Rocket Digital Marketing
