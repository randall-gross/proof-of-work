---
name: prove
description: Run proof-of-work verification on current session's work. Produces an Evidence Report Card scoring claims vs reality.
---

Run the proof-of-work orchestrator agent to verify all work claimed in this session.

Load and follow the instructions in the proof-of-work agent at `${CLAUDE_PLUGIN_ROOT}/agents/proof-of-work.md`.

The agent will:
1. Gather evidence (session log, git diff, quality contract)
2. Extract and verify completion claims
3. Check for scope drift, band-aids, build/test status
4. Grade quality against the project's quality contract
5. Produce a scored Evidence Report Card with verdict: VERIFIED, NEEDS REVIEW, or FAILED
