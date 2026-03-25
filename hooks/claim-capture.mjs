#!/usr/bin/env node
/**
 * claim-capture.mjs — PostToolUse hook for Bash, Write, and Edit tools
 * Silently logs every tool call to .proof-of-work/session.jsonl
 * for later comparison by the verification agent.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

const SESSION_DIR = resolve(process.cwd(), '.proof-of-work');
const SESSION_FILE = resolve(SESSION_DIR, 'session.jsonl');
const GITIGNORE_FILE = resolve(SESSION_DIR, '.gitignore');
const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function ensureSessionDir() {
  mkdirSync(SESSION_DIR, { recursive: true });
}

function ensureGitignore() {
  if (!existsSync(GITIGNORE_FILE)) {
    writeFileSync(GITIGNORE_FILE, '*\n', 'utf-8');
  }
}

function maybeResetSession() {
  if (!existsSync(SESSION_FILE)) return;
  try {
    const content = readFileSync(SESSION_FILE, 'utf-8');
    const firstLine = content.split('\n').find(line => line.trim() !== '');
    if (!firstLine) return;
    const parsed = JSON.parse(firstLine);
    if (!parsed.ts) return;
    const age = Date.now() - new Date(parsed.ts).getTime();
    if (age > SESSION_MAX_AGE_MS) {
      writeFileSync(SESSION_FILE, '', 'utf-8');
    }
  } catch {
    // Corrupted file — reset it
    writeFileSync(SESSION_FILE, '', 'utf-8');
  }
}

function extractFileInfo(input) {
  const toolName = input?.tool_name ?? 'unknown';
  let file = null;

  if (toolName === 'Bash') {
    file = input?.tool_input?.command ?? null;
  } else {
    file = input?.tool_input?.file_path ?? null;
  }

  return { tool: toolName, file };
}

async function main() {
  let input;
  try {
    const raw = await readStdin();
    input = JSON.parse(raw);
  } catch {
    // Can't parse — approve silently
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
    process.exit(0);
  }

  try {
    ensureSessionDir();
    ensureGitignore();
    maybeResetSession();

    const { tool, file } = extractFileInfo(input);
    const ts = new Date().toISOString();

    const entry = JSON.stringify({ tool, file, ts }) + '\n';
    appendFileSync(SESSION_FILE, entry, 'utf-8');
  } catch {
    // Never fail — this hook is purely observational
  }

  process.stdout.write(JSON.stringify({ decision: 'approve' }));
  process.exit(0);
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ decision: 'approve' }));
  process.exit(0);
});
