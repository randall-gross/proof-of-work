import { execFileSync } from 'child_process';
import { resolve } from 'path';

/**
 * Check if the current directory is a git repository
 * @param {string} cwd - working directory
 * @returns {boolean}
 */
export function isGitRepo(cwd) {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get git diff stat summary
 * @param {string} cwd - working directory
 * @returns {string} - raw git diff --stat output
 */
export function getGitDiffStat(cwd) {
  try {
    return execFileSync('git', ['diff', '--stat'], { cwd, encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

/**
 * Get git diff, optionally truncated
 * @param {string} cwd - working directory
 * @param {number} [maxLines=500] - max lines to return
 * @returns {{ diff: string, truncated: boolean }}
 */
export function getGitDiff(cwd, maxLines = 500) {
  try {
    const full = execFileSync('git', ['diff'], { cwd, encoding: 'utf-8' });
    const lines = full.split('\n');
    if (lines.length > maxLines) {
      return { diff: lines.slice(0, maxLines).join('\n'), truncated: true };
    }
    return { diff: full, truncated: false };
  } catch {
    return { diff: '', truncated: false };
  }
}

/**
 * Get list of changed file paths
 * @param {string} cwd - working directory
 * @returns {string[]} - array of relative file paths
 */
export function getChangedFiles(cwd) {
  try {
    const output = execFileSync('git', ['diff', '--name-only'], { cwd, encoding: 'utf-8' });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
