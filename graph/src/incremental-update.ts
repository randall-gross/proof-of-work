// Called by: node --experimental-sqlite dist/incremental-update.js --file <path>
// One-shot: open DB, parse file, upsert, exit

import { GraphStore } from './store.js';
import * as parser from './parser.js';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeFileHash } from './incremental.js';

async function main() {
  // Parse --file argument from process.argv
  const fileIdx = process.argv.indexOf('--file');
  if (fileIdx === -1 || !process.argv[fileIdx + 1]) {
    console.error('Usage: incremental-update --file <path>');
    process.exit(1);
  }
  const filePath = process.argv[fileIdx + 1];

  // Resolve paths
  const absPath = resolve(filePath);
  if (!existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  // Initialize store
  const dbDir = resolve(process.cwd(), '.proof-of-work');
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
  const store = new GraphStore(resolve(dbDir, 'graph.db'));

  try {
    // Initialize parser
    await parser.init();

    // Read file content and compute hash
    const content = readFileSync(absPath, 'utf-8');
    const hash = computeFileHash(content);

    // Check if file has changed (by hash)
    // Look up existing nodes for this file — if hash matches, skip
    const existingNodes = store.getNodesByFile(filePath);
    if (existingNodes.length > 0 && existingNodes[0].file_hash === hash) {
      // File hasn't changed, skip
      process.exit(0);
    }

    // Delete old records for this file
    store.deleteFileNodes(filePath);

    // Parse file and upsert new records
    const { nodes, edges } = await parser.parseFile(filePath, content);
    const now = new Date().toISOString();
    for (const node of nodes) {
      node.file_hash = hash;
      node.updated_at = now;
      store.upsertNode(node);
    }
    for (const edge of edges) {
      edge.updated_at = now;
      store.upsertEdge(edge);
    }

    // Update metadata
    store.setMetadata('last_updated', new Date().toISOString());

    console.log(`[proof-of-work] updated ${nodes.length} nodes, ${edges.length} edges for ${filePath}`);
  } finally {
    store.close();
  }
}

main().catch(err => {
  console.error('incremental-update failed:', err);
  process.exit(1);
});
