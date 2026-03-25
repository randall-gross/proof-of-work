---
name: proof-of-work
description: Verification suite that catches false completeness. Hard-gates completion claims with evidence scoring, code graph analysis, and quality grading.
metadata:
  priority: 90
  pathPatterns:
    - '.proof-of-work/**'
    - 'quality-contract.md'
  bashPatterns:
    - '/prove'
    - 'proof-of-work'
  importPatterns: []
  promptSignals:
    phrases:
      - 'proof of work'
      - 'verify my work'
      - 'evidence report'
      - 'false completeness'
    allOf: []
    anyOf: []
    noneOf: []
    minScore: 6
---

# proof-of-work

AI coding assistants claim work is done when it isn't. They skip error handling, leave stubs, silently rewrite files, or hallucinate that a build passed. **proof-of-work** intercepts these patterns and demands real evidence before any completion claim is accepted.

Three failure modes it targets:

1. **Silent rewrites** — agent overwrites a file wholesale instead of making surgical edits
2. **Premature completion claims** — agent says "done" before verifying the build, tests, or scope
3. **Band-aids / scope drift** — agent patches over a problem with `as any`, `@ts-ignore`, or empty catches instead of fixing it

---

## How It Works

Three enforcement layers run as Claude hooks:

**PreToolUse — Rewrite guard + Band-aid guard**
- `rewrite-guard.mjs` fires on every `Write` call. Computes effective change % using both line-count delta and a line-retention ratio. Blocks the write if it exceeds `rewriteThreshold` (default 60%).
- `band-aid-guard.mjs` fires on `Edit` and `Write`. Scans the incoming content for band-aid patterns. In `prevent`/`both` mode, blocks the tool call and demands a real fix.

**PostToolUse — Claim capture + Graph update**
- `claim-capture.mjs` silently appends every `Bash`, `Write`, and `Edit` call to `.proof-of-work/session.jsonl`. The session file resets automatically after 4 hours.
- `graph-update.mjs` triggers after `Edit`/`Write` to keep the SQLite code graph current.

**Stop — Completion gate**
- `completion-gate.mjs` fires when Claude emits a Stop event. It scores the final assistant message for completion signals using a compound scoring system:
  - **Strong signals** (3 pts each): "all tests pass", "ready for review", "task complete", "acceptance criteria met", etc.
  - **Weak signals** (1 pt each): "done", "fixed", "implemented", "complete", etc.
  - Phrases like "done reading" or "finished checking" are stripped before scoring.
  - Threshold: score ≥ 3 triggers the gate. When `autoVerify: true`, injects a system message instructing Claude to run `/prove` before presenting work as final.

---

## Commands

- `/prove` — Run a full verification pass. Scores all session evidence and outputs the Evidence Report Card.
- `/prove init` — Initialize proof-of-work for this project. Creates `.claude/proof-of-work.local.md` with default config and copies `quality-contract.md` to `.claude/quality-contract.md`.
- `/prove init --detect` — Same as above, but auto-detects frameworks (package.json, lock files, config files) and pre-fills `buildCommand` and `testCommand`.
- `/prove rebuild` — Force a full rebuild of the code graph from scratch. Use after large refactors or when the graph is stale.

---

## The Evidence Report Card

`/prove` outputs a scored report card:

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

### Scoring

Each component contributes to the 100-point score. When a component is N/A (e.g., no test command configured), its points redistribute proportionally among the active components.

| Component | Points | What it measures |
|-----------|--------|-----------------|
| Claims verified | 30 | Ratio of completion claims backed by real evidence in session.jsonl |
| Scope drift | 20 | Files changed outside the stated task scope |
| Build | 15 | `buildCommand` exits 0 |
| Tests | 15 | `testCommand` exits 0, no regressions |
| Reality grade | 10 | Quality contract checklist completion rate |
| Band-aids | 10 | Absence of detected patch-over patterns |

### Verdicts

| Score | Verdict | Meaning |
|-------|---------|---------|
| 80 – 100 | **VERIFIED** | Safe to ship |
| 50 – 79 | **NEEDS REVIEW** | Human should spot-check |
| 0 – 49 | **FAILED** | Task not complete |

**Zero-config works** — at `verificationLevel: git`, scoring runs on git evidence alone. Build and test scoring are opt-in via `buildCommand` / `testCommand`.

---

## Configuration

Create `.claude/proof-of-work.local.md` in your project root:

```markdown
---
verificationLevel: git
rewriteThreshold: 60
autoVerify: true
bandAidMode: detect
buildCommand: npm run build
testCommand: npm test
---

Project-specific notes go here.
```

| Key | Default | Description |
|-----|---------|-------------|
| `verificationLevel` | `git` | Depth of verification: `git`, `build`, or `full` |
| `rewriteThreshold` | `60` | % effective change in a Write that triggers the rewrite guard |
| `autoVerify` | `true` | Inject `/prove` reminder on Stop when completion signals detected |
| `bandAidMode` | `detect` | `detect` warns in report, `prevent` blocks the edit, `both` does both |
| `buildCommand` | `null` | Shell command to verify the build (enables Build scoring) |
| `testCommand` | `null` | Shell command to run tests (enables Tests scoring) |

---

## Quality Contract

`quality-contract.md` is an optional but recommended checklist that defines the minimum quality bar for any code change. It covers:

- **Error handling** — async try/catch, input validation, correct HTTP status codes
- **UI completeness** — loading/error/empty states, form validation, responsive layout
- **Code hygiene** — no TODOs, no hardcoded secrets, no console.log in production
- **Security** — input sanitization, auth checks on protected routes, no secrets on the client
- **Testing** — unit tests, edge cases, no regressions

Generate a project-specific contract with `/prove init`. Add project-specific rules to the **Section 6** placeholder. The Reality grade component in scoring reflects how many checklist items are satisfied.

---

## Code Graph

The `pow-graph` MCP server maintains a SQLite-backed dependency graph of your codebase, built with tree-sitter. It tracks files, functions, classes, and types as nodes, with typed edges (CALLS, IMPORTS_FROM, INHERITS, IMPLEMENTS, CONTAINS, TESTED_BY).

**MCP tools exposed:**

- `build_or_update_graph` — Parse source files and update the graph incrementally
- `get_impact_radius` — Given a file or symbol, return all nodes and files transitively affected
- `query_graph` — SQL-style query against nodes and edges
- `semantic_search_nodes` — Find nodes by name or qualified name
- `find_large_functions` — Identify functions exceeding a line threshold
- `list_graph_stats` — Summary counts (nodes, edges, files)
- `get_review_context` — Focused context for a file (its imports, exports, callers, tests)

The graph enables `/prove` to score scope drift accurately — it knows exactly which symbols a task should have touched versus what was actually modified.

---

## Band-Aid Detection

Detected patterns and their severity:

| Pattern | Severity |
|---------|----------|
| `as any` | high |
| `as unknown as` | high |
| `@ts-ignore` | high |
| empty catch `catch(e) {}` | high |
| `@ts-expect-error` | medium |
| non-null assertion `foo!` | medium |
| `eslint-disable` (line or block) | medium |
| `TODO` / `FIXME` / `HACK` comments | low |

**Escape hatch:** Add `// pow-ignore: <reason>` on the same line to suppress detection for intentional suppression (e.g., a known upstream type bug). This is logged and counted in the report — overuse is visible in the score.
