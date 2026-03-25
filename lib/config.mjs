import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const DEFAULTS = {
  verificationLevel: 'git',
  rewriteThreshold: 60,
  autoVerify: true,
  bandAidMode: 'detect',
  buildCommand: null,
  testCommand: null,
};

export function loadConfig(projectRoot) {
  const configPath = resolve(projectRoot, '.claude', 'proof-of-work.local.md');
  if (!existsSync(configPath)) return { ...DEFAULTS };

  const content = readFileSync(configPath, 'utf-8');
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return { ...DEFAULTS };

  const parsed = {};
  for (const line of frontmatterMatch[1].split('\n')) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      let value = match[2].trim();
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (value === 'null') value = null;
      else if (/^\d+$/.test(value)) value = parseInt(value, 10);
      parsed[match[1]] = value;
    }
  }

  return { ...DEFAULTS, ...parsed };
}
