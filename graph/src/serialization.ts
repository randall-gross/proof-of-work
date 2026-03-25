import type { GraphNode, GraphEdge, ImpactResult } from './types.js';

/**
 * Convert a raw SQLite row to a GraphNode.
 * Handles is_test: 0/1 → boolean conversion.
 */
export function rowToNode(row: Record<string, unknown>): GraphNode {
  return {
    id: row.id as number | undefined,
    kind: row.kind as GraphNode['kind'],
    qualified_name: row.qualified_name as string,
    file_path: row.file_path as string,
    name: row.name as string,
    line_start: row.line_start as number,
    line_end: row.line_end as number,
    language: row.language as string,
    parent_name: (row.parent_name as string | null) ?? null,
    params: (row.params as string | null) ?? null,
    return_type: (row.return_type as string | null) ?? null,
    modifiers: (row.modifiers as string | null) ?? null,
    is_test: row.is_test === 1 || row.is_test === true,
    file_hash: row.file_hash as string,
    updated_at: row.updated_at as string,
  };
}

/**
 * Convert a raw SQLite row to a GraphEdge.
 */
export function rowToEdge(row: Record<string, unknown>): GraphEdge {
  return {
    id: row.id as number | undefined,
    source: row.source as string,
    target: row.target as string,
    kind: row.kind as GraphEdge['kind'],
    file_path: row.file_path as string,
    updated_at: row.updated_at as string,
  };
}

/**
 * Format a GraphNode for human-readable MCP tool output.
 * Example: "[Function] src/auth.ts::validateToken (lines 15-42) [export, async]"
 */
export function formatNode(node: GraphNode): string {
  const modifiersPart = node.modifiers
    ? ` [${parseModifiers(node.modifiers).join(', ')}]`
    : '';

  return `[${node.kind}] ${node.qualified_name} (lines ${node.line_start}-${node.line_end})${modifiersPart}`;
}

/**
 * Format a GraphEdge for human-readable output.
 * Example: "src/auth.ts::validateToken -[CALLS]-> src/utils.ts::hashPassword"
 */
export function formatEdge(edge: GraphEdge): string {
  return `${edge.source} -[${edge.kind}]-> ${edge.target}`;
}

/**
 * Format a list of nodes as a summary string.
 * Groups by kind, counts each, then lists them.
 */
export function formatNodeList(nodes: GraphNode[]): string {
  if (nodes.length === 0) {
    return '(no nodes)';
  }

  // Group by kind
  const grouped = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    if (!grouped.has(node.kind)) {
      grouped.set(node.kind, []);
    }
    grouped.get(node.kind)!.push(node);
  }

  // Build output
  const lines: string[] = [];
  for (const [kind, kindNodes] of grouped) {
    lines.push(`${kind}: ${kindNodes.length}`);
    for (const node of kindNodes) {
      lines.push(`  ${node.qualified_name}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format an ImpactResult as a summary string.
 */
export function formatImpactSummary(result: ImpactResult): string {
  const lines: string[] = [];

  lines.push(`Changed: ${result.changed_nodes.length} node(s)`);
  if (result.changed_nodes.length > 0) {
    for (const node of result.changed_nodes) {
      lines.push(`  - ${formatNode(node)}`);
    }
  }

  lines.push('');
  lines.push(`Impacted: ${result.impacted_nodes.length} node(s)`);
  if (result.impacted_nodes.length > 0) {
    for (const node of result.impacted_nodes) {
      lines.push(`  - ${formatNode(node)}`);
    }
  }

  lines.push('');
  lines.push(`Affected Files: ${result.impacted_files.length}`);
  for (const file of result.impacted_files) {
    lines.push(`  - ${file}`);
  }

  if (result.truncated) {
    lines.push('');
    lines.push('(Results truncated — query too large)');
  }

  return lines.join('\n');
}

/**
 * Parse modifiers JSON string to array.
 * Input: '["export", "async"]'
 * Output: ['export', 'async']
 */
function parseModifiers(modifiersJson: string): string[] {
  try {
    const parsed = JSON.parse(modifiersJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
