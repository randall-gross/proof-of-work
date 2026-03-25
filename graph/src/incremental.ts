import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, extname } from 'node:path';
import type { BuildResult } from './types.js';
import type { GraphStore } from './store.js';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const EXCLUDED_PATHS = ['node_modules', '.next', '.expo', 'dist', '.proof-of-work'];
const MAX_TRACKED_FILES = 10_000;

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/**
 * Returns deduplicated relative paths of changed source files (.ts/.tsx/.js/.jsx).
 * Checks HEAD~1 diff first (committed changes), falls back to cached diff on failure
 * (e.g., single-commit repo), then also merges in unstaged diffs.
 */
export function getChangedFiles(repoRoot: string): string[] {
  const results = new Set<string>();

  // Primary: committed changes since HEAD~1
  try {
    const committed = execFileSync('git', ['diff', 'HEAD~1', '--name-only'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    for (const line of committed.trim().split('\n')) {
      if (line) results.add(line);
    }
  } catch {
    // Fallback: staged (cached) changes — handles single-commit repos
    try {
      const staged = execFileSync('git', ['diff', '--cached', '--name-only'], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
      for (const line of staged.trim().split('\n')) {
        if (line) results.add(line);
      }
    } catch {
      // Ignore — no staged changes or git unavailable
    }
  }

  // Also include unstaged changes
  try {
    const unstaged = execFileSync('git', ['diff', '--name-only'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    for (const line of unstaged.trim().split('\n')) {
      if (line) results.add(line);
    }
  } catch {
    // Ignore
  }

  return [...results].filter((f) => SOURCE_EXTENSIONS.has(extname(f)));
}

/**
 * Returns all git-tracked source files in the repo, excluding common build/output
 * directories. Capped at MAX_TRACKED_FILES.
 */
export function getTrackedFiles(repoRoot: string): string[] {
  let output: string;
  try {
    output = execFileSync('git', ['ls-files'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
  } catch {
    console.warn('[proof-of-work] git ls-files failed — returning empty file list');
    return [];
  }

  const files = output
    .trim()
    .split('\n')
    .filter((f) => {
      if (!f) return false;
      if (!SOURCE_EXTENSIONS.has(extname(f))) return false;
      if (EXCLUDED_PATHS.some((excluded) => f.includes(excluded))) return false;
      return true;
    });

  if (files.length > MAX_TRACKED_FILES) {
    console.warn(
      `[proof-of-work] getTrackedFiles: ${files.length} files found, capping at ${MAX_TRACKED_FILES}`
    );
    return files.slice(0, MAX_TRACKED_FILES);
  }

  return files;
}

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------

/** Returns a SHA-256 hex digest for the given content string. */
export function computeFileHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// Dependency graph helpers
// ---------------------------------------------------------------------------

/**
 * Returns paths of files that import from any of the given changed files.
 * Uses IMPORTS_FROM edges where target === changedFile.
 */
export function findDependentFiles(store: GraphStore, changedFiles: string[]): string[] {
  const dependents = new Set<string>();

  for (const changedFile of changedFiles) {
    const edges = store.getEdges({ target: changedFile, kind: 'IMPORTS_FROM' });
    for (const edge of edges) {
      dependents.add(edge.source);
    }
  }

  return [...dependents];
}

// ---------------------------------------------------------------------------
// Build orchestration
// ---------------------------------------------------------------------------

/**
 * Parses a single file and upserts its nodes + edges into the store.
 * Returns the count of nodes and edges written, or null on error.
 */
async function processFile(
  store: GraphStore,
  parser: typeof import('./parser.js'),
  absolutePath: string,
  relativePath: string,
  errors: string[]
): Promise<{ nodes: number; edges: number } | null> {
  try {
    const content = readFileSync(absolutePath, 'utf8');
    const hash = computeFileHash(content);
    const { nodes, edges } = await parser.parseFile(relativePath, content);

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

    return { nodes: nodes.length, edges: edges.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`${relativePath}: ${message}`);
    return null;
  }
}

/**
 * Full build — parses every tracked source file and upserts into the store.
 * Called on first `/prove` run or `/prove rebuild`.
 */
export async function fullBuild(
  store: GraphStore,
  parser: typeof import('./parser.js'),
  repoRoot: string
): Promise<BuildResult> {
  const trackedFiles = getTrackedFiles(repoRoot);
  const errors: string[] = [];
  let totalNodes = 0;
  let totalEdges = 0;

  for (const relPath of trackedFiles) {
    const absPath = resolve(repoRoot, relPath);
    const result = await processFile(store, parser, absPath, relPath, errors);
    if (result) {
      totalNodes += result.nodes;
      totalEdges += result.edges;
    }
  }

  store.setMetadata('last_updated', new Date().toISOString());

  return {
    files_parsed: trackedFiles.length - errors.length,
    total_nodes: totalNodes,
    total_edges: totalEdges,
    errors,
    changed_files: trackedFiles,
  };
}

/**
 * Incremental build — only processes changed files and their dependents.
 * This is the default mode for `pow_build_graph`.
 */
export async function incrementalBuild(
  store: GraphStore,
  parser: typeof import('./parser.js'),
  repoRoot: string
): Promise<BuildResult> {
  const changedFiles = getChangedFiles(repoRoot);
  const dependentFiles = findDependentFiles(store, changedFiles);

  // Combine and deduplicate
  const toProcess = [...new Set([...changedFiles, ...dependentFiles])];

  const errors: string[] = [];
  let totalNodes = 0;
  let totalEdges = 0;

  for (const relPath of toProcess) {
    // Remove stale records before re-parsing
    store.deleteFileNodes(relPath);

    const absPath = resolve(repoRoot, relPath);
    const result = await processFile(store, parser, absPath, relPath, errors);
    if (result) {
      totalNodes += result.nodes;
      totalEdges += result.edges;
    }
  }

  store.setMetadata('last_updated', new Date().toISOString());

  return {
    files_parsed: toProcess.length - errors.length,
    total_nodes: totalNodes,
    total_edges: totalEdges,
    errors,
    changed_files: changedFiles,
  };
}
