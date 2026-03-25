import Parser from 'web-tree-sitter';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GraphNode, GraphEdge } from './types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Language to WASM file mapping
const LANG_MAP: Record<string, string> = {
  '.ts': 'tree-sitter-typescript.wasm',
  '.tsx': 'tree-sitter-tsx.wasm',
  '.js': 'tree-sitter-javascript.wasm',
  '.jsx': 'tree-sitter-javascript.wasm',
};

let initialized = false;
const languages: Map<string, Parser.Language> = new Map();

export async function init(): Promise<void> {
  if (initialized) return;

  // Initialize tree-sitter with the core WASM
  const wasmDir = resolve(__dirname, '..', 'wasm');
  await Parser.init({
    locateFile: () => resolve(wasmDir, 'tree-sitter.wasm'),
  });

  // Load each language grammar
  for (const [, wasmFile] of Object.entries(LANG_MAP)) {
    if (!languages.has(wasmFile)) {
      const lang = await Parser.Language.load(resolve(wasmDir, wasmFile));
      languages.set(wasmFile, lang);
    }
  }

  initialized = true;
}

export function getLanguageForExt(ext: string): Parser.Language | null {
  const wasmFile = LANG_MAP[ext];
  return wasmFile ? languages.get(wasmFile) ?? null : null;
}

export async function parseFile(
  filePath: string,
  content: string
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  await init();

  const ext = extname(filePath);
  const language = getLanguageForExt(ext);
  if (!language) return { nodes: [], edges: [] };

  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(content);

  // Import helpers dynamically to avoid circular deps during init
  const { extractAll } = await import('./parser-helpers.js');
  return extractAll(tree, filePath, content, ext);
}
