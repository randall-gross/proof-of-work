import type { GraphStore } from '../store.js';
import * as parser from '../parser.js';
import { fullBuild, incrementalBuild } from '../incremental.js';

export async function handleBuildGraph(
  store: GraphStore,
  args: { full_rebuild?: boolean; repo_root?: string }
) {
  const repoRoot = args.repo_root || process.cwd();
  const result = args.full_rebuild
    ? await fullBuild(store, parser, repoRoot)
    : await incrementalBuild(store, parser, repoRoot);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(result, null, 2),
    }],
  };
}
