import type { GraphNode, GraphEdge, ImpactResult } from './types.js';
import type { GraphStore } from './store.js';

const MAX_VISITED = 500;

export function computeImpactRadius(
  store: GraphStore,
  changedFiles: string[],
  maxDepth: number = 2
): ImpactResult {
  const allNodes = store.getAllNodes();
  const allEdges = store.getAllEdges();

  // Build adjacency lists keyed by qualified_name
  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();

  for (const edge of allEdges) {
    if (!forward.has(edge.source)) forward.set(edge.source, new Set());
    forward.get(edge.source)!.add(edge.target);

    if (!reverse.has(edge.target)) reverse.set(edge.target, new Set());
    reverse.get(edge.target)!.add(edge.source);
  }

  // Build a lookup map from qualified_name → GraphNode
  const nodeMap = new Map<string, GraphNode>();
  for (const node of allNodes) {
    nodeMap.set(node.qualified_name, node);
  }

  // Collect seed nodes (nodes whose file_path is in changedFiles)
  const changedFileSet = new Set(changedFiles);
  const seedNodes: GraphNode[] = allNodes.filter(n => changedFileSet.has(n.file_path));
  const seedNames = new Set(seedNodes.map(n => n.qualified_name));

  // BFS
  interface QueueEntry {
    name: string;
    depth: number;
  }

  const visited = new Set<string>();
  const queue: QueueEntry[] = [];
  let truncated = false;

  // Initialise queue with seeds at depth 0
  for (const seed of seedNodes) {
    if (!visited.has(seed.qualified_name)) {
      visited.add(seed.qualified_name);
      queue.push({ name: seed.qualified_name, depth: 0 });
    }
  }

  let head = 0;
  while (head < queue.length) {
    const { name, depth } = queue[head++];

    if (depth >= maxDepth) continue;

    const neighbors = new Set<string>([
      ...(forward.get(name) ?? []),
      ...(reverse.get(name) ?? []),
    ]);

    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;

      if (visited.size >= MAX_VISITED) {
        truncated = true;
        break;
      }

      visited.add(neighbor);
      queue.push({ name: neighbor, depth: depth + 1 });
    }

    if (truncated) break;
  }

  // Collect impacted nodes (visited but not seeds)
  const impactedNodes: GraphNode[] = [];
  for (const name of visited) {
    if (!seedNames.has(name)) {
      const node = nodeMap.get(name);
      if (node) impactedNodes.push(node);
    }
  }

  // Unique impacted file paths
  const impactedFiles = [...new Set(impactedNodes.map(n => n.file_path))];

  // Edges where either end is in the visited set
  const relevantEdges = allEdges.filter(
    e => visited.has(e.source) || visited.has(e.target)
  );

  return {
    changed_nodes: seedNodes,
    impacted_nodes: impactedNodes,
    impacted_files: impactedFiles,
    edges: relevantEdges,
    truncated,
    total_impacted: impactedNodes.length,
  };
}

// ---------------------------------------------------------------------------
// Inline test — run with: node --loader ts-node/esm graph/src/bfs.ts
// (or via ts-node / tsx directly)
// ---------------------------------------------------------------------------
if (process.argv[1]?.endsWith('bfs.ts') || process.argv[1]?.endsWith('bfs.js')) {
  runTest();
}

function makeNode(name: string, file: string): GraphNode {
  return {
    kind: 'Function',
    qualified_name: name,
    file_path: file,
    name,
    line_start: 1,
    line_end: 10,
    language: 'typescript',
    parent_name: null,
    params: null,
    return_type: null,
    modifiers: null,
    is_test: false,
    file_hash: 'hash',
    updated_at: new Date().toISOString(),
  };
}

function makeEdge(source: string, target: string): GraphEdge {
  return {
    source,
    target,
    kind: 'CALLS',
    file_path: source.split('::')[0],
    updated_at: new Date().toISOString(),
  };
}

function runTest(): void {
  // Build an in-memory store backed by :memory:
  // We use a dynamic import trick so this file stays importable without side-effects.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GraphStore } = require('./store.js') as { GraphStore: typeof import('./store.js').GraphStore };

  const store = new GraphStore(':memory:');

  const nodeA = makeNode('a.ts::A', 'a.ts');
  const nodeB = makeNode('b.ts::B', 'b.ts');
  const nodeC = makeNode('c.ts::C', 'c.ts');
  const nodeD = makeNode('d.ts::D', 'd.ts');

  store.upsertNode(nodeA);
  store.upsertNode(nodeB);
  store.upsertNode(nodeC);
  store.upsertNode(nodeD);

  store.upsertEdge(makeEdge('a.ts::A', 'b.ts::B')); // A → B
  store.upsertEdge(makeEdge('b.ts::B', 'c.ts::C')); // B → C
  store.upsertEdge(makeEdge('c.ts::C', 'd.ts::D')); // C → D

  const result = computeImpactRadius(store, ['a.ts'], 2);

  const impactedNames = result.impacted_nodes.map(n => n.qualified_name).sort();

  console.log('changed_nodes:', result.changed_nodes.map(n => n.qualified_name));
  console.log('impacted_nodes:', impactedNames);
  console.log('truncated:', result.truncated);

  const bAndCPresent =
    impactedNames.includes('b.ts::B') && impactedNames.includes('c.ts::C');
  const dAbsent = !impactedNames.includes('d.ts::D');

  if (bAndCPresent && dAbsent) {
    console.log('TEST PASSED: B and C are impacted; D is not (maxDepth=2).');
  } else {
    console.error('TEST FAILED');
    console.error('  B and C present:', bAndCPresent);
    console.error('  D absent:', dAbsent);
    process.exit(1);
  }

  store.close();
}
