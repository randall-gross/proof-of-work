# proof-of-work — Architecture Document

> Generated from the full source graph on 2026-03-25.
> This document is the single reference for understanding how every component connects.

---

## Overview

proof-of-work is a Claude Code plugin that intercepts AI completion claims and forces real verification. It operates through three enforcement layers (PreToolUse, PostToolUse, Stop hooks), a SQLite-backed code graph (MCP server), and an orchestrator agent that scores evidence into a 100-point report card.

---

## System Architecture

```
                          ┌──────────────────────────────┐
                          │       Claude Code Session     │
                          └──────────┬───────────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         │                           │                           │
    PreToolUse                  PostToolUse                    Stop
    (before tool runs)          (after tool runs)         (session end)
         │                           │                           │
    ┌────┴────┐               ┌──────┴──────┐             ┌─────┴─────┐
    │         │               │             │             │           │
rewrite   band-aid        claim          graph       completion
 guard     guard          capture        update         gate
    │         │               │             │             │
    │    Scans for        Appends to    Calls           Scores last
    │    as any,         session.jsonl   incremental-    message for
    │    @ts-ignore,                     update.js       completion
    │    empty catch                     (tree-sitter    signals
    │                                     → SQLite)
    │
    │ Computes effective
    │ change % (line-count
    │ delta + line-retention
    │ ratio). Blocks if
    │ > threshold.
    │
    └─── Blocks or approves ───────────────────────────────────────┘

                          ┌──────────────────────────────┐
                          │   /prove command triggers     │
                          │   proof-of-work agent         │
                          └──────────┬───────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
         Evidence              Claim Extraction        Scoring Engine
         Gathering             & Diff Audit            (9 sections)
              │                      │                      │
     session.jsonl            Last assistant            Weighted 100-pt
     git diff                 message parsed            score with N/A
     quality-contract.md      for action claims         redistribution
     plugin config                                          │
                                                     Evidence Report Card
                                                     ┌──────────────────┐
                                                     │ VERDICT: VERIFIED│
                                                     │ Score: 85/100    │
                                                     └──────────────────┘
```

---

## Component Map

### Hooks Layer

| File | Event | Matcher | Purpose |
|------|-------|---------|---------|
| `hooks/rewrite-guard.mjs` | PreToolUse | `Write` | Blocks silent full-file rewrites exceeding threshold |
| `hooks/band-aid-guard.mjs` | PreToolUse | `Edit\|Write` | Blocks band-aid patterns when mode is `prevent` or `both` |
| `hooks/claim-capture.mjs` | PostToolUse | `Bash\|Write\|Edit` | Silently logs every tool call to `.proof-of-work/session.jsonl` |
| `hooks/graph-update.mjs` | PostToolUse | `Edit\|Write` | Triggers incremental graph update for changed JS/TS files |
| `hooks/completion-gate.mjs` | Stop | `.*` | Scores final message for completion signals; injects `/prove` reminder |

All hooks follow the same safety contract:
- Read JSON from stdin
- Never crash — all errors fall through to `{ decision: "approve" }`
- Write exactly one JSON object to stdout: `{ decision, reason?, systemMessage? }`

### Shared Libraries

| File | Exports | Used By |
|------|---------|---------|
| `lib/config.mjs` | `loadConfig(projectRoot)` | rewrite-guard, band-aid-guard, completion-gate |
| `lib/band-aid-patterns.mjs` | `BAND_AID_PATTERNS`, `POW_IGNORE`, `scanForBandAids(content)` | band-aid-guard |
| `lib/git-evidence.mjs` | `isGitRepo`, `getGitDiffStat`, `getGitDiff`, `getChangedFiles` | proof-of-work agent |

### Commands

| Command | File | Description |
|---------|------|-------------|
| `/prove` | `commands/prove.md` | Runs the full verification agent |
| `/prove init` | `commands/prove-init.md` | Scaffolds quality-contract.md; `--detect` auto-detects frameworks |
| `/prove rebuild` | `commands/prove-rebuild.md` | Force-rebuilds the code graph from scratch |

### Agent

| File | Description |
|------|-------------|
| `agents/proof-of-work.md` | 9-section orchestrator: evidence gathering → claim extraction → diff audit → scope check → band-aid scan → build check → test check → reality check → scoring + report card |

### Skill

| File | Description |
|------|-------------|
| `skills/proof-of-work/SKILL.md` | Full reference documentation. Triggers on `.proof-of-work/**`, `quality-contract.md`, `/prove` commands. Priority 90. |

---

## Code Graph Engine

The graph engine is a standalone TypeScript project in `graph/` that compiles to `graph/dist/`. It provides both an MCP server (for interactive queries) and a CLI entry point (for PostToolUse hook updates).

### Architecture

```
graph/src/
├── server.ts              MCP server entry (stdio transport)
├── store.ts               SQLite wrapper (GraphStore class)
├── types.ts               Node/Edge/Result type definitions
├── parser.ts              tree-sitter WASM initialization + parseFile()
├── parser-helpers.ts      AST extraction: functions, classes, types, imports, calls
├── incremental.ts         Build orchestration: full + incremental + git helpers
├── incremental-update.ts  CLI entry: single-file update (used by graph-update hook)
├── bfs.ts                 BFS impact radius computation (max depth, cap at 500 nodes)
├── serialization.ts       Human-readable formatters for MCP tool output
└── tools/
    ├── build-graph.ts     pow_build_graph handler
    ├── graph-stats.ts     pow_graph_stats handler
    ├── query-graph.ts     pow_query_graph handler (6 query patterns)
    └── impact-radius.ts   pow_impact_radius handler
```

### Data Model

**Nodes** represent code symbols:

| Field | Type | Description |
|-------|------|-------------|
| `kind` | `File \| Function \| Class \| Type \| Test` | Symbol category |
| `qualified_name` | string | Unique ID: `file_path::ClassName::methodName` |
| `file_path` | string | Relative path from repo root |
| `name` | string | Short name |
| `line_start` / `line_end` | number | Source location |
| `language` | string | `typescript` or `javascript` |
| `parent_name` | string? | Enclosing class name (for methods) |
| `params` | string? | Parameter list text |
| `return_type` | string? | Return type annotation |
| `modifiers` | string? | JSON array: `["export", "async"]` |
| `is_test` | boolean | Detected via name (`test`, `it`, `describe`) or path (`.test.`, `.spec.`, `__tests__/`) |
| `file_hash` | string | SHA-256 of file content (skip-if-unchanged optimization) |

**Edges** represent relationships:

| Kind | Meaning | Extracted From |
|------|---------|----------------|
| `CALLS` | Function A calls function B | `call_expression` nodes in AST |
| `IMPORTS_FROM` | File A imports from file B | `import_statement` nodes (relative imports only) |
| `INHERITS` | Class A extends class B | *(reserved, not yet extracted)* |
| `IMPLEMENTS` | Class A implements interface B | *(reserved, not yet extracted)* |
| `CONTAINS` | Class contains method | Class body → method_definition |
| `TESTED_BY` | Symbol is tested by test function | *(reserved, populated via convention)* |
| `DEPENDS_ON` | Generic dependency | *(reserved)* |

### MCP Tools

| Tool | Purpose | Key Args |
|------|---------|----------|
| `pow_build_graph` | Parse files and update graph | `full_rebuild?: boolean`, `repo_root?: string` |
| `pow_query_graph` | Query relationships | `pattern`: `callers_of \| callees_of \| imports_of \| importers_of \| tests_for \| file_summary`, `target`: qualified name or file path |
| `pow_impact_radius` | BFS blast radius from changed files | `changed_files: string[]`, `max_depth?: number` (default 2, cap 500 nodes) |
| `pow_graph_stats` | Node/edge/file counts + last updated | `repo_root?: string` |

### Build Pipeline

```
Source files (.ts/.tsx/.js/.jsx)
        │
        ▼
    tree-sitter WASM
    (web-tree-sitter + language grammars)
        │
        ▼
    parser-helpers.ts
    ├── extractFunctions()   → Function/Test nodes
    ├── extractClasses()     → Class nodes + CONTAINS edges + method nodes
    ├── extractTypes()       → Type nodes
    ├── extractImports()     → IMPORTS_FROM edges (relative only)
    └── extractCalls()       → CALLS edges (filtered: no builtins, only known functions)
        │
        ▼
    GraphStore (SQLite)
    ├── nodes table (UNIQUE on qualified_name, upsert on conflict)
    ├── edges table (UNIQUE on source+target+kind)
    ├── metadata table (key-value for last_updated, etc.)
    └── Indexes: file_path, kind, qualified_name, source, target
```

**Incremental update flow** (PostToolUse hook path):
1. `graph-update.mjs` receives Edit/Write event
2. Checks file extension (.ts/.tsx/.js/.jsx only) and skip patterns (node_modules, .next, dist)
3. Calls `node --experimental-sqlite graph/dist/incremental-update.js --file <path>`
4. `incremental-update.ts` opens the SQLite DB, computes file hash, skips if unchanged
5. Deletes old nodes/edges for that file, re-parses, upserts new records

**Full build flow** (`/prove rebuild` or `pow_build_graph --full_rebuild`):
1. `git ls-files` to enumerate all tracked source files (cap: 10,000)
2. Filter by extension, exclude node_modules/dist/.next/.expo/.proof-of-work
3. Parse each file, upsert all nodes and edges
4. Update `last_updated` metadata

**Incremental build flow** (`pow_build_graph` default):
1. `git diff HEAD~1 --name-only` + `git diff --name-only` to find changed files
2. Query IMPORTS_FROM edges to find dependent files
3. Delete and re-parse only changed + dependent files

---

## Verification Agent (9-Section Pipeline)

The agent in `agents/proof-of-work.md` runs a strict 9-section pipeline:

### Section 0: Overview
Sets the context — what will be verified and how.

### Section 1: Evidence Gathering
Collects raw inputs:
- **Session log** — `.proof-of-work/session.jsonl` (tool calls with timestamps)
- **Git diff** — `git diff --stat` + `git diff` (truncated at 500 lines)
- **Quality contract** — `quality-contract.md` if it exists
- **Plugin config** — `.claude/proof-of-work.local.md` YAML frontmatter
- Produces an **Evidence Status** summary block

### Section 2: Claim Extraction
Parses the last assistant message for completion claims:
- Action verbs + targets ("Updated auth.ts")
- Checklist items ("Created migration")
- Summary lists ("Here's what I did: 1. ... 2. ...")
- Implicit claims ("The build passes")

Each claim normalized to: `{ claim, file, action, subject, verify_via }`

### Section 3: Diff Audit
Per-claim verification against evidence:
1. File presence in git diff
2. Session log corroboration
3. Diff content match (specific code patterns)
4. Code graph verification (callers updated?)

Verdicts: `VERIFIED | PARTIAL | UNVERIFIED | NO_EVIDENCE | UNTESTABLE`

Also reports **unclaimed changes** — files in the diff not mentioned by any claim.

### Section 4: Scope Check
Compares actual changes to the original request:
1. Identify original request + refinements
2. Build expected scope
3. Classify each changed file: `IN_SCOPE | DEPENDENCY | DRIFT`
4. Use `pow_impact_radius` to distinguish real dependencies from drift

Assessment: `CLEAN | MINOR DRIFT | SIGNIFICANT DRIFT`

### Section 5: Band-Aid Scan
Scans added lines in git diff for:

| Pattern | Severity | Points Deducted |
|---------|----------|-----------------|
| `as any` | HIGH | -3 |
| `as unknown as` | HIGH | -3 |
| `@ts-ignore` | HIGH | -3 |
| `catch (e) {}` / `catch {}` | HIGH | -3 |
| `@ts-expect-error` | MEDIUM | -2 |
| Non-null assertion `foo!` | MEDIUM | -2 |
| `eslint-disable` | MEDIUM | -2 |
| `TODO` / `FIXME` / `HACK` | LOW | -1 |

Escape hatch: `// pow-ignore: <reason>` — acknowledged but not deducted.
Score: starts at 10, minimum 0.

### Section 6: Build Check
Only runs when `verificationLevel` is `build` or `full`.
Detects build command from `package.json` scripts or `CONFIG.buildCommand`.
Pass = 15 points, Fail = 0 points.

### Section 7: Test Check
Only runs when `verificationLevel` is `full`.
Detects test command from `package.json` scripts or `CONFIG.testCommand`.
Parses Jest/Vitest/Mocha/Playwright output formats.
Pass = 15 points, Fail = 0 points.

### Section 8: Reality Check
Only runs when `quality-contract.md` exists.
Evaluates each applicable checklist item against the diff.
Grades: A (90%+) = 10pts, B (75-89%) = 8pts, C (60-74%) = 6pts, D (40-59%) = 3pts, F (<40%) = 0pts.

Includes constructive framing: "First-pass work is typically C+/B-. That is normal, not failure."

### Section 9: Scoring and Report Card
Collects all component scores, handles N/A redistribution (proportional), renders the final report card.

**Scoring weights:**

| Component | Max Points | Source Section |
|-----------|-----------|----------------|
| Claims verified | 30 | Section 3 |
| No scope drift | 20 | Section 4 |
| Build passes | 15 | Section 6 |
| Tests pass | 15 | Section 7 |
| Reality grade | 10 | Section 8 |
| No band-aids | 10 | Section 5 |

**N/A redistribution:** When components are skipped (e.g., no build command configured), their points redistribute proportionally to active components. This means a git-only verification (`verificationLevel: git`) still scores on a 100-point scale using Claims (30), Scope (20), Reality (10), and Band-aids (10) — each scaled up proportionally.

**Verdicts:**

| Score | Verdict | Meaning |
|-------|---------|---------|
| 80-100 | VERIFIED | Safe to ship |
| 50-79 | NEEDS REVIEW | Human should spot-check |
| 0-49 | FAILED | Task not complete |

---

## Data Flow Diagram

```
User request → Claude works → tool calls flow through hooks:

  Write("auth.ts", content)
    ├── PreToolUse: rewrite-guard checks change % → approve/block
    ├── PreToolUse: band-aid-guard scans for patterns → approve/block
    ├── [Claude writes the file]
    ├── PostToolUse: claim-capture logs {tool:"Write", file:"auth.ts", ts} to session.jsonl
    └── PostToolUse: graph-update runs incremental-update.js on auth.ts

  Claude says "All done, auth is fixed"
    └── Stop: completion-gate scores message (score=4: "done"=1 + "fixed"=1 + strong signal match)
        → Injects: "Run /prove before presenting as final"

  /prove
    └── Agent spawns → reads session.jsonl + git diff + quality-contract
        → Extracts claims from "All done, auth is fixed"
        → Verifies "fixed" claim against auth.ts diff
        → Checks scope (only auth files changed? or drift?)
        → Scans for band-aids in diff
        → Scores everything → Evidence Report Card
```

---

## Configuration

Config lives in `.claude/proof-of-work.local.md` (YAML frontmatter):

```yaml
---
verificationLevel: git      # git | build | full
rewriteThreshold: 60        # % change that triggers rewrite guard
autoVerify: true             # inject /prove reminder on Stop
bandAidMode: detect          # detect | prevent | both
buildCommand: npm run build  # enables Build scoring
testCommand: npm test        # enables Test scoring
---
```

`loadConfig()` merges project config over defaults. Missing keys get defaults.

---

## File System Artifacts

| Path | Created By | Purpose | Gitignored? |
|------|-----------|---------|-------------|
| `.proof-of-work/session.jsonl` | claim-capture hook | Tool call log (resets after 4h) | Yes (`.proof-of-work/.gitignore` contains `*`) |
| `.proof-of-work/graph.db` | graph engine | SQLite code graph | Yes |
| `.proof-of-work/graph.db-wal` | SQLite WAL mode | Write-ahead log | Yes |
| `.claude/proof-of-work.local.md` | `/prove init` | Project config | Should be gitignored (contains local prefs) |
| `quality-contract.md` | `/prove init` | Quality checklist | No — shared with team |

---

## Installation

### Option A: Development (per-session)

```bash
claude --plugin-dir "C:\Users\tekk7\Projects\proof-of-work"
```

### Option B: Persistent (git marketplace)

Add to your Claude Code marketplace repo, then in `settings.json`:

```json
{
  "plugins": {
    "proof-of-work@my-claude-plugins": true
  }
}
```

### First-run setup in any project

```
/prove init --detect
```

This creates:
- `.claude/proof-of-work.local.md` with detected build/test commands
- `quality-contract.md` at project root

---

## Dependencies

### Runtime (hooks)
- Node.js (any version with ESM support)
- No npm dependencies — hooks use only `fs`, `path`, `child_process`, `url`

### Runtime (graph engine)
- Node.js with `--experimental-sqlite` flag
- `@modelcontextprotocol/sdk` — MCP stdio server
- `web-tree-sitter` — WASM-based parser
- `tree-sitter-javascript` + `tree-sitter-typescript` — language grammars

### Build (graph engine)
- `esbuild` — bundles TypeScript to ESM
- `typescript` — type checking

---

## Completion Signal Detection

The completion gate uses a compound scoring system to avoid false positives:

**Strong signals (3 points each):** "all tests pass", "ready for review", "ready to merge", "ship it", "task complete", "acceptance criteria met", "all criteria met", "everything is working"

**Weak signals (1 point each):** "done", "finished", "complete", "implemented", "fixed", "updated"

**Ignore contexts (stripped before scoring):** "done reading", "done exploring", "finished checking", "complete list", "done for now", "finished looking", "done with"

**Threshold:** score >= 3 triggers the gate. One strong signal alone triggers. Three weak signals trigger. "Done reading" does not trigger.
