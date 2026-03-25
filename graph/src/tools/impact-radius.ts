import type { GraphStore } from '../store.js';
import { computeImpactRadius } from '../bfs.js';
import { formatImpactSummary } from '../serialization.js';

export function handleImpactRadius(
  store: GraphStore,
  args: { changed_files: string[]; max_depth?: number }
) {
  const result = computeImpactRadius(store, args.changed_files, args.max_depth ?? 2);
  const summary = formatImpactSummary(result);

  return {
    content: [{
      type: 'text' as const,
      text: summary + '\n\n' + JSON.stringify({
        changed_count: result.changed_nodes.length,
        impacted_count: result.impacted_nodes.length,
        impacted_files: result.impacted_files,
        truncated: result.truncated,
      }, null, 2),
    }],
  };
}
