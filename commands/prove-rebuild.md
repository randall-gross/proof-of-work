---
name: prove-rebuild
description: Force a full rebuild of the proof-of-work code graph.
---

Force a complete rebuild of the code knowledge graph.

## Steps

1. Delete the existing graph database: remove `.proof-of-work/graph.db` and `.proof-of-work/graph.db-wal` if they exist
2. Call the `pow_build_graph` MCP tool with `{ "full_rebuild": true }` to parse all tracked source files
3. Report the build results: files parsed, nodes created, edges created, any errors
