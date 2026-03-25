import type { GraphNode, GraphEdge } from '../types.js';
import type { GraphStore } from '../store.js';
import { formatNode, formatEdge, formatNodeList } from '../serialization.js';

export function handleQueryGraph(
  store: GraphStore,
  args: { pattern: string; target: string }
) {
  const { pattern, target } = args;

  switch (pattern) {
    case 'callers_of': {
      const edges = store.getEdges({ target, kind: 'CALLS' });
      const callerNames = edges.map(e => e.source);
      const callers = callerNames.map(n => store.getNodeByName(n)).filter((n): n is GraphNode => n !== null);
      return formatResult(`Callers of ${target}`, callers, edges);
    }
    case 'callees_of': {
      const edges = store.getEdges({ source: target, kind: 'CALLS' });
      const calleeNames = edges.map(e => e.target);
      const callees = calleeNames.map(n => store.getNodeByName(n)).filter((n): n is GraphNode => n !== null);
      return formatResult(`Callees of ${target}`, callees, edges);
    }
    case 'imports_of': {
      const edges = store.getEdges({ source: target, kind: 'IMPORTS_FROM' });
      return formatResult(`Imports of ${target}`, [], edges);
    }
    case 'importers_of': {
      const edges = store.getEdges({ target, kind: 'IMPORTS_FROM' });
      return formatResult(`Files importing ${target}`, [], edges);
    }
    case 'tests_for': {
      const edges = store.getEdges({ target, kind: 'TESTED_BY' });
      const testNames = edges.map(e => e.source);
      const tests = testNames.map(n => store.getNodeByName(n)).filter((n): n is GraphNode => n !== null);
      return formatResult(`Tests for ${target}`, tests, edges);
    }
    case 'file_summary': {
      const nodes = store.getNodesByFile(target);
      const nodeList = formatNodeList(nodes);
      return {
        content: [{
          type: 'text' as const,
          text: `File summary: ${target}\n${nodeList}`,
        }],
      };
    }
    default:
      return {
        content: [{
          type: 'text' as const,
          text: `Unknown pattern: ${pattern}`,
        }],
        isError: true,
      };
  }
}

function formatResult(title: string, nodes: GraphNode[], edges: GraphEdge[]) {
  const lines = [title, ''];
  if (nodes.length > 0) {
    lines.push(`Nodes (${nodes.length}):`);
    nodes.forEach(n => lines.push(`  ${formatNode(n)}`));
  }
  if (edges.length > 0) {
    lines.push(`Edges (${edges.length}):`);
    edges.forEach(e => lines.push(`  ${formatEdge(e)}`));
  }
  if (nodes.length === 0 && edges.length === 0) {
    lines.push('No results found.');
  }
  return {
    content: [{ type: 'text' as const, text: lines.join('\n') }],
  };
}
