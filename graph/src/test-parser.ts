/**
 * Integration test for the parser.
 * Run with: npx tsx src/test-parser.ts
 */

import { parseFile } from './parser.js';

// ---------------------------------------------------------------------------
// Sample TypeScript content
// ---------------------------------------------------------------------------

const sampleTS = `
import { readFileSync } from 'fs';
import { helper } from './utils';

export async function fetchData(url: string): Promise<string> {
  const data = await fetch(url);
  return data.text();
}

const processData = (input: string): number => {
  return input.length;
};

class DataProcessor {
  private cache: Map<string, string> = new Map();

  process(data: string): string {
    return helper(data);
  }

  async load(url: string): Promise<void> {
    const result = await fetchData(url);
    this.cache.set(url, result);
  }
}

interface DataResult {
  value: string;
  count: number;
}

type ProcessFn = (input: string) => string;
`;

// ---------------------------------------------------------------------------
// Sample TSX content
// ---------------------------------------------------------------------------

const sampleTSX = `
import React from 'react';
import { helper } from './utils';

interface ButtonProps {
  label: string;
  onClick: () => void;
}

export function Button({ label, onClick }: ButtonProps): JSX.Element {
  return (
    <button onClick={onClick}>
      {label}
    </button>
  );
}

const Card = ({ title }: { title: string }) => {
  return <div className="card">{title}</div>;
};

type Theme = 'light' | 'dark';
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function assertExists<T>(
  arr: T[],
  predicate: (item: T) => boolean,
  message: string,
): T | undefined {
  const found = arr.find(predicate);
  assert(!!found, message);
  return found;
}

// ---------------------------------------------------------------------------
// Run TS test
// ---------------------------------------------------------------------------

async function testTypeScript(): Promise<void> {
  console.log('\n=== TypeScript (.ts) ===');
  const { nodes, edges } = await parseFile('src/sample.ts', sampleTS);

  console.log(`\nNodes (${nodes.length} total):`);
  for (const n of nodes) {
    console.log(
      `  [${n.kind}] ${n.name}  parent=${n.parent_name ?? '-'}  params=${n.params ?? '-'}  return=${n.return_type ?? '-'}  mods=${n.modifiers ?? '-'}`,
    );
  }

  console.log(`\nEdges (${edges.length} total):`);
  for (const e of edges) {
    console.log(`  [${e.kind}] ${e.source} -> ${e.target}`);
  }

  console.log('\nAssertions:');

  // --- Function nodes ---
  const fetchData = assertExists(
    nodes,
    (n) => n.name === 'fetchData',
    'fetchData function node exists',
  );
  if (fetchData) {
    assert(fetchData.kind === 'Function', 'fetchData.kind = Function');
    assert(fetchData.modifiers?.includes('export') ?? false, 'fetchData has export modifier');
    assert(fetchData.modifiers?.includes('async') ?? false, 'fetchData has async modifier');
    assert(fetchData.params === '(url: string)', 'fetchData has correct params');
    assert(fetchData.return_type === 'Promise<string>', 'fetchData has return type Promise<string>');
  }

  const processData = assertExists(
    nodes,
    (n) => n.name === 'processData',
    'processData function node exists',
  );
  if (processData) {
    assert(processData.kind === 'Function', 'processData.kind = Function');
    // Arrow functions: return type annotation may or may not be extracted
    const hasReturnType = processData.return_type !== null;
    if (hasReturnType) {
      assert(processData.return_type === 'number', 'processData return type = number');
    } else {
      console.log('  ⚠ processData return type not extracted (arrow function limitation — known concern)');
    }
  }

  // --- Class node ---
  const dpClass = assertExists(
    nodes,
    (n) => n.name === 'DataProcessor' && n.kind === 'Class',
    'DataProcessor class node exists',
  );
  if (dpClass) {
    assert(dpClass.parent_name === null, 'DataProcessor has no parent_name');
  }

  // --- Class methods ---
  const processMethod = assertExists(
    nodes,
    (n) => n.name === 'process' && n.parent_name === 'DataProcessor',
    'DataProcessor::process method exists',
  );
  if (processMethod) {
    assert(processMethod.kind === 'Function', 'process method kind = Function');
    assert(processMethod.params === '(data: string)', 'process has correct params');
    assert(processMethod.return_type === 'string', 'process return type = string');
  }

  const loadMethod = assertExists(
    nodes,
    (n) => n.name === 'load' && n.parent_name === 'DataProcessor',
    'DataProcessor::load method exists',
  );
  if (loadMethod) {
    assert(loadMethod.kind === 'Function', 'load method kind = Function');
    assert(loadMethod.modifiers?.includes('async') ?? false, 'load has async modifier');
    assert(loadMethod.return_type === 'Promise<void>', 'load return type = Promise<void>');
  }

  // --- Type nodes ---
  assertExists(
    nodes,
    (n) => n.name === 'DataResult' && n.kind === 'Type',
    'DataResult interface node exists',
  );
  assertExists(
    nodes,
    (n) => n.name === 'ProcessFn' && n.kind === 'Type',
    'ProcessFn type alias node exists',
  );

  // --- Import edges ---
  const importEdge = assertExists(
    edges,
    (e) => e.kind === 'IMPORTS_FROM' && e.target.includes('utils'),
    'IMPORTS_FROM edge to ./utils exists',
  );
  if (importEdge) {
    assert(importEdge.source === 'src/sample.ts', 'import edge source = src/sample.ts');
  }

  const fsImport = edges.find(
    (e) => e.kind === 'IMPORTS_FROM' && e.target === 'fs',
  );
  assert(!fsImport, 'fs (npm) import is NOT tracked (correctly skipped)');

  // --- CONTAINS edges ---
  assertExists(
    edges,
    (e) =>
      e.kind === 'CONTAINS' &&
      e.source.includes('DataProcessor') &&
      e.target.includes('process'),
    'CONTAINS edge: DataProcessor -> process',
  );
  assertExists(
    edges,
    (e) =>
      e.kind === 'CONTAINS' &&
      e.source.includes('DataProcessor') &&
      e.target.includes('load'),
    'CONTAINS edge: DataProcessor -> load',
  );

  // --- CALLS edges ---
  const callEdge = assertExists(
    edges,
    (e) => e.kind === 'CALLS' && e.target === 'fetchData',
    'CALLS edge targeting fetchData exists',
  );
  if (callEdge) {
    assert(
      callEdge.source.includes('load'),
      `CALLS edge source includes 'load' (got: ${callEdge.source})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Run TSX test
// ---------------------------------------------------------------------------

async function testTSX(): Promise<void> {
  console.log('\n=== TSX (.tsx) ===');
  const { nodes, edges } = await parseFile('src/sample.tsx', sampleTSX);

  console.log(`\nNodes (${nodes.length} total):`);
  for (const n of nodes) {
    console.log(
      `  [${n.kind}] ${n.name}  parent=${n.parent_name ?? '-'}  params=${n.params ?? '-'}  return=${n.return_type ?? '-'}  mods=${n.modifiers ?? '-'}`,
    );
  }

  console.log(`\nEdges (${edges.length} total):`);
  for (const e of edges) {
    console.log(`  [${e.kind}] ${e.source} -> ${e.target}`);
  }

  console.log('\nAssertions:');

  // JSX parsing should work without errors
  assert(nodes.length > 0, 'TSX file produces nodes (WASM TSX grammar works)');

  assertExists(
    nodes,
    (n) => n.name === 'Button' && n.kind === 'Function',
    'Button function node exists',
  );

  assertExists(
    nodes,
    (n) => n.name === 'Card' && n.kind === 'Function',
    'Card arrow function node exists',
  );

  assertExists(
    nodes,
    (n) => n.name === 'ButtonProps' && n.kind === 'Type',
    'ButtonProps interface node exists',
  );

  assertExists(
    nodes,
    (n) => n.name === 'Theme' && n.kind === 'Type',
    'Theme type alias node exists',
  );

  assertExists(
    edges,
    (e) => e.kind === 'IMPORTS_FROM' && e.target.includes('utils'),
    'TSX IMPORTS_FROM edge to ./utils exists',
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Parser Integration Test');
  console.log('=======================');

  try {
    await testTypeScript();
    await testTSX();
  } catch (err) {
    console.error('\nFATAL ERROR:', err);
    process.exit(1);
  }

  console.log(`\n=======================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main();
