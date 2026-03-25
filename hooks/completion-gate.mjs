#!/usr/bin/env node
/**
 * completion-gate.mjs — Stop hook
 * Detects completion signals in Claude's last assistant message and triggers verification.
 * Compound scoring prevents false positives: one STRONG signal (3pts) or three WEAK signals (3pts total).
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../lib/config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..');

// STRONG signals — 3 points each (one alone triggers)
const STRONG_SIGNALS = [
  'all tests pass',
  'ready for review',
  'ready to merge',
  'ship it',
  'task complete',
  'acceptance criteria met',
  'all criteria met',
  'everything is working',
];

// WEAK signals — 1 point each (need 3 to trigger)
const WEAK_SIGNALS = [
  'done',
  'finished',
  'complete',
  'implemented',
  'fixed',
  'updated',
];

// IGNORE contexts — remove these phrases before scoring
const IGNORE_CONTEXTS = [
  'done reading',
  'done exploring',
  'finished checking',
  'complete list',
  'done for now',
  'finished looking',
  'done with',
];

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function extractLastAssistantMessage(transcript) {
  // Try to parse transcript as a JSON array of messages
  let messages;
  try {
    messages = JSON.parse(transcript);
  } catch {
    // Parsing failed — use raw transcript string
    return typeof transcript === 'string' ? transcript : String(transcript);
  }

  if (!Array.isArray(messages)) {
    return typeof transcript === 'string' ? transcript : String(transcript);
  }

  // Find the last message with role: "assistant"
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === 'assistant') {
      const content = msg.content;
      if (typeof content === 'string') {
        return content;
      }
      // content is an object or array — stringify it
      return JSON.stringify(content);
    }
  }

  // No assistant message found — return empty string
  return '';
}

function scoreText(text) {
  // Step 1: lowercase
  let normalized = text.toLowerCase();

  // Step 2: remove IGNORE context phrases
  for (const phrase of IGNORE_CONTEXTS) {
    normalized = normalized.split(phrase).join(' ');
  }

  let score = 0;

  // Step 3: score STRONG signals (3 points each)
  for (const signal of STRONG_SIGNALS) {
    if (normalized.includes(signal)) {
      score += 3;
    }
  }

  // Step 4: score WEAK signals (1 point each, word boundary)
  for (const signal of WEAK_SIGNALS) {
    const regex = new RegExp(`\\b${signal}\\b`, 'g');
    const matches = normalized.match(regex);
    if (matches) {
      score += matches.length;
    }
  }

  return score;
}

async function main() {
  let input;
  try {
    const raw = await readStdin();
    input = JSON.parse(raw);
  } catch {
    // Can't parse stdin — approve silently
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
    process.exit(0);
  }

  try {
    const config = loadConfig(PLUGIN_ROOT);

    // Extract the transcript field
    const transcriptRaw = input?.stop_hook_input?.transcript ?? input?.transcript ?? '';

    // Get the last assistant message text
    const lastMessage = extractLastAssistantMessage(transcriptRaw);

    // Score the message
    const score = scoreText(lastMessage);

    if (score < 3) {
      // Below threshold — approve silently
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
      process.exit(0);
    }

    // Score >= 3 — completion signals detected
    if (config.autoVerify) {
      process.stdout.write(
        JSON.stringify({
          decision: 'approve',
          reason: `Completion signals detected (score: ${score})`,
          systemMessage:
            'PROOF-OF-WORK: Completion signals detected in your response. Before the user accepts this work, run /prove to generate an Evidence Report Card. Do not present the work as final until verification completes.',
        })
      );
    } else {
      process.stdout.write(
        JSON.stringify({
          decision: 'approve',
          reason: `Completion signals detected (score: ${score})`,
          systemMessage: 'Completion claimed. Run /prove to verify.',
        })
      );
    }

    process.exit(0);
  } catch {
    // Never crash — always approve
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
    process.exit(0);
  }
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ decision: 'approve' }));
  process.exit(0);
});
