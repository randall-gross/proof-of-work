import type { GraphStore } from '../store.js';

export function handleGraphStats(store: GraphStore) {
  const stats = store.getStats();
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(stats, null, 2),
    }],
  };
}
