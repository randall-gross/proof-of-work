#!/usr/bin/env node
/**
 * rewrite-guard.mjs — PreToolUse hook for the Write tool
 * Blocks silent full-file rewrites that exceed the configured threshold.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../lib/config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..');

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function computeEffectiveChangePct(oldContent, newContent) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Metric 1: line count delta percentage
  const lineCountDelta =
    Math.abs(newLines.length - oldLines.length) /
    Math.max(oldLines.length, 1) *
    100;

  // Metric 2: keep ratio — compare sets of trimmed non-empty lines
  const oldSet = new Set(oldLines.map(l => l.trim()).filter(Boolean));
  const newSet = new Set(newLines.map(l => l.trim()).filter(Boolean));

  let kept = 0;
  for (const line of oldSet) {
    if (newSet.has(line)) kept++;
  }

  const keepRatio = oldSet.size > 0 ? kept / oldSet.size : 1;

  // Effective change % is the worse of the two metrics
  const effectiveChangePct = Math.max(lineCountDelta, (1 - keepRatio) * 100);

  return { effectiveChangePct, oldLineCount: oldLines.length, newLineCount: newLines.length };
}

async function main() {
  let input;
  try {
    const raw = await readStdin();
    input = JSON.parse(raw);
  } catch {
    // If we can't parse stdin, approve silently to avoid blocking Claude
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
    process.exit(0);
  }

  const filePath = input?.tool_input?.file_path;
  const newContent = input?.tool_input?.content;

  // If we can't determine the file path, approve
  if (!filePath || newContent === undefined) {
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
    process.exit(0);
  }

  // Resolve the absolute path
  const absolutePath = resolve(filePath);

  // New file — approve silently
  if (!existsSync(absolutePath)) {
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
    process.exit(0);
  }

  // Read existing file content
  let oldContent;
  try {
    oldContent = readFileSync(absolutePath, 'utf-8');
  } catch {
    // Can't read — approve silently
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
    process.exit(0);
  }

  // Load config to get the threshold
  const config = loadConfig(PLUGIN_ROOT);
  const threshold = config.rewriteThreshold ?? 60;

  // Compute effective change percentage
  const { effectiveChangePct, oldLineCount, newLineCount } = computeEffectiveChangePct(
    oldContent,
    newContent
  );

  if (effectiveChangePct > threshold) {
    const fileName = filePath.split(/[\\/]/).pop();
    const pct = Math.round(effectiveChangePct);
    process.stdout.write(
      JSON.stringify({
        decision: 'block',
        reason: `This would rewrite ${pct}% of ${fileName} (${oldLineCount} → ${newLineCount} lines). Use Edit for surgical changes, or confirm you intend a full rewrite.`,
      })
    );
    process.exit(0);
  }

  process.stdout.write(JSON.stringify({ decision: 'approve' }));
  process.exit(0);
}

main().catch(err => {
  // On unexpected errors, approve to avoid blocking Claude
  process.stderr.write(`rewrite-guard error: ${err.message}\n`);
  process.stdout.write(JSON.stringify({ decision: 'approve' }));
  process.exit(0);
});
