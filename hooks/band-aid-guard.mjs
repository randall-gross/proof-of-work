#!/usr/bin/env node
/**
 * band-aid-guard.mjs — PreToolUse hook for Edit|Write tools
 * Blocks band-aid patterns (as any, @ts-ignore, empty catch, etc.)
 * when bandAidMode is 'prevent' or 'both'.
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../lib/config.mjs';
import { scanForBandAids } from '../lib/band-aid-patterns.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..');

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function main() {
  let input;
  try {
    const raw = await readStdin();
    input = JSON.parse(raw);
  } catch {
    // Can't parse stdin — approve silently to avoid blocking Claude
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
    process.exit(0);
  }

  // Load config and check bandAidMode
  const config = loadConfig(PLUGIN_ROOT);
  const mode = config.bandAidMode ?? 'detect';

  // Only intervene in prevent or both modes
  if (mode !== 'prevent' && mode !== 'both') {
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
    process.exit(0);
  }

  // Extract the content to scan — Write uses `content`, Edit uses `new_string`
  const content = input?.tool_input?.content ?? input?.tool_input?.new_string;
  const filePath = input?.tool_input?.file_path ?? '(unknown file)';

  if (!content) {
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
    process.exit(0);
  }

  const hits = scanForBandAids(content);

  if (hits.length === 0) {
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
    process.exit(0);
  }

  // Report the first hit
  const hit = hits[0];
  const reason =
    `Band-aid detected: \`${hit.pattern}\` at line ${hit.line} in ${filePath}.\n` +
    `"${hit.text}"\n` +
    `This masks the problem instead of fixing it. Fix the underlying type/logic error instead.\n` +
    `If intentional, add a \`// pow-ignore: <reason>\` comment on the same line and retry.`;

  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

main().catch(err => {
  // On unexpected errors, approve to avoid blocking Claude
  process.stderr.write(`band-aid-guard error: ${err.message}\n`);
  process.stdout.write(JSON.stringify({ decision: 'approve' }));
  process.exit(0);
});
