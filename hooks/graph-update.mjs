#!/usr/bin/env node
/**
 * graph-update.mjs — PostToolUse hook for Edit|Write tools
 * Calls the graph engine's incremental-update CLI after each code change.
 * Gracefully noops when the graph script doesn't exist (Phase 3 not built yet).
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, extname } from 'path';

const VALID_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SKIP_PATTERNS = ['node_modules', '.next', '.expo', 'dist', '.proof-of-work'];

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function approve() {
  process.stdout.write(JSON.stringify({ decision: 'approve' }));
  process.exit(0);
}

async function main() {
  let input;
  try {
    const raw = await readStdin();
    input = JSON.parse(raw);
  } catch {
    approve();
  }

  const filePath = input?.tool_input?.file_path;

  // No file path — approve silently
  if (!filePath) {
    approve();
  }

  // Check extension — only process JS/TS files
  const ext = extname(filePath);
  if (!VALID_EXTENSIONS.has(ext)) {
    approve();
  }

  // Skip paths containing excluded directories
  const normalizedPath = filePath.replace(/\\/g, '/');
  for (const pattern of SKIP_PATTERNS) {
    if (normalizedPath.includes(pattern)) {
      approve();
    }
  }

  // Locate the graph update script
  const pluginRoot =
    process.env.CLAUDE_PLUGIN_ROOT ?? resolve(import.meta.dirname, '..');
  const updateScript = resolve(pluginRoot, 'graph', 'dist', 'incremental-update.js');

  // If the script doesn't exist, graph hasn't been built yet — approve silently
  if (!existsSync(updateScript)) {
    approve();
  }

  // Run the incremental update — catch all errors, never fail the hook
  try {
    execFileSync(
      'node',
      ['--experimental-sqlite', updateScript, '--file', resolve(filePath)],
      { timeout: 15000, stdio: 'ignore' }
    );
  } catch {
    // Graph update errors are non-fatal — this hook is purely observational
  }

  approve();
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ decision: 'approve' }));
  process.exit(0);
});
