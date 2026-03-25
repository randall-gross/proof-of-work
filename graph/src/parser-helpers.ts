import type Parser from 'web-tree-sitter';
import type { GraphNode, GraphEdge } from './types.js';
import { dirname, posix } from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SyntaxNode = Parser.SyntaxNode;

function walk(node: SyntaxNode, callback: (n: SyntaxNode) => void): void {
  callback(node);
  for (const child of node.namedChildren) {
    walk(child, callback);
  }
}

function langFromExt(ext: string): string {
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  if (ext === '.js' || ext === '.jsx') return 'javascript';
  return 'unknown';
}

function now(): string {
  return new Date().toISOString();
}

function makeNode(partial: Omit<GraphNode, 'file_hash' | 'updated_at' | 'id'>): GraphNode {
  return { ...partial, file_hash: '', updated_at: now() };
}

function makeEdge(partial: Omit<GraphEdge, 'updated_at' | 'id'>): GraphEdge {
  return { ...partial, updated_at: now() };
}

/**
 * Collect modifier keywords from a node and its parent export wrapper.
 */
function collectModifiers(node: SyntaxNode): string[] {
  const mods: string[] = [];

  // Check if wrapped in export_statement
  const parent = node.parent;
  if (parent?.type === 'export_statement') {
    mods.push('export');
    // Check for default keyword in export statement
    if (parent.text.startsWith('export default')) {
      mods.push('default');
    }
  }

  // Check for async keyword
  if (node.type === 'function_declaration' || node.type === 'method_definition') {
    const text = node.text;
    if (text.trimStart().startsWith('async ')) {
      mods.push('async');
    }
  }

  // Arrow functions: check the variable declaration context
  if (node.type === 'arrow_function') {
    const arrowText = node.text;
    if (arrowText.trimStart().startsWith('async ')) {
      mods.push('async');
    }
  }

  // Check for abstract on classes
  if (node.type === 'class_declaration' || node.type === 'abstract_class_declaration') {
    if (node.text.trimStart().startsWith('abstract ')) {
      mods.push('abstract');
    }
  }

  return mods;
}

/**
 * Extract the parameter list text from a parameters node.
 */
function extractParams(node: SyntaxNode): string | null {
  const params = node.childForFieldName('parameters');
  if (params) return params.text;

  // For arrow functions, the parameter may be a formal_parameters child
  for (const child of node.namedChildren) {
    if (child.type === 'formal_parameters') return child.text;
  }
  return null;
}

/**
 * Extract return type annotation text.
 */
function extractReturnType(node: SyntaxNode): string | null {
  const ret = node.childForFieldName('return_type');
  if (ret) {
    // Strip the leading ": "
    const text = ret.text;
    return text.startsWith(':') ? text.slice(1).trim() : text;
  }
  return null;
}

/**
 * Find the nearest enclosing function/method name for a given node.
 */
function findEnclosingFunction(node: SyntaxNode): string | null {
  let current = node.parent;
  while (current) {
    if (
      current.type === 'function_declaration' ||
      current.type === 'method_definition'
    ) {
      const nameNode = current.childForFieldName('name');
      return nameNode?.text ?? null;
    }
    // Arrow function assigned to variable
    if (current.type === 'arrow_function') {
      const declarator = current.parent;
      if (declarator?.type === 'variable_declarator') {
        const nameNode = declarator.childForFieldName('name');
        return nameNode?.text ?? null;
      }
    }
    current = current.parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// isTestFunction
// ---------------------------------------------------------------------------

export function isTestFunction(name: string, filePath: string): boolean {
  const testNames = ['test', 'it', 'describe', 'spec'];
  const nameLower = name.toLowerCase();
  if (testNames.some((t) => nameLower === t || nameLower.startsWith(t))) return true;

  const pathNorm = filePath.replace(/\\/g, '/');
  if (
    pathNorm.includes('.test.') ||
    pathNorm.includes('.spec.') ||
    pathNorm.includes('__tests__/') ||
    pathNorm.includes('__test__/')
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Node extractors
// ---------------------------------------------------------------------------

export function extractFunctions(
  tree: Parser.Tree,
  filePath: string,
  _content: string,
  ext: string,
): { nodes: GraphNode[]; names: Set<string> } {
  const nodes: GraphNode[] = [];
  const names = new Set<string>();
  const lang = langFromExt(ext);
  const root = tree.rootNode;

  walk(root, (node) => {
    // --- Standard function declarations ---
    if (node.type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      const name = nameNode?.text;
      if (!name) return;

      const mods = collectModifiers(node);
      const test = isTestFunction(name, filePath);

      nodes.push(
        makeNode({
          kind: test ? 'Test' : 'Function',
          qualified_name: `${filePath}::${name}`,
          file_path: filePath,
          name,
          line_start: node.startPosition.row + 1,
          line_end: node.endPosition.row + 1,
          language: lang,
          parent_name: null,
          params: extractParams(node),
          return_type: extractReturnType(node),
          modifiers: mods.length ? JSON.stringify(mods) : null,
          is_test: test,
        }),
      );
      names.add(name);
      return; // don't descend into nested arrows as standalone functions
    }

    // --- Arrow functions assigned to const/let/var ---
    if (node.type === 'arrow_function') {
      const declarator = node.parent;
      if (declarator?.type !== 'variable_declarator') return;

      const nameNode = declarator.childForFieldName('name');
      const name = nameNode?.text;
      if (!name) return;

      // Gather modifiers from the lexical_declaration / export_statement
      const lexDecl = declarator.parent; // lexical_declaration or variable_declaration
      const mods: string[] = [];
      const exportParent = lexDecl?.parent;
      if (exportParent?.type === 'export_statement') {
        mods.push('export');
        if (exportParent.text.startsWith('export default')) {
          mods.push('default');
        }
      }

      // Check for async on the arrow function itself
      if (node.text.trimStart().startsWith('async ')) {
        mods.push('async');
      }

      const test = isTestFunction(name, filePath);

      nodes.push(
        makeNode({
          kind: test ? 'Test' : 'Function',
          qualified_name: `${filePath}::${name}`,
          file_path: filePath,
          name,
          line_start: (lexDecl?.startPosition.row ?? node.startPosition.row) + 1,
          line_end: node.endPosition.row + 1,
          language: lang,
          parent_name: null,
          params: extractParams(node),
          return_type: extractReturnType(node),
          modifiers: mods.length ? JSON.stringify(mods) : null,
          is_test: test,
        }),
      );
      names.add(name);
    }
  });

  return { nodes, names };
}

export function extractClasses(
  tree: Parser.Tree,
  filePath: string,
  _content: string,
  ext: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const lang = langFromExt(ext);
  const root = tree.rootNode;

  walk(root, (node) => {
    if (node.type !== 'class_declaration' && node.type !== 'abstract_class_declaration') return;

    const nameNode = node.childForFieldName('name');
    const className = nameNode?.text;
    if (!className) return;

    const mods = collectModifiers(node);
    const classQN = `${filePath}::${className}`;

    nodes.push(
      makeNode({
        kind: 'Class',
        qualified_name: classQN,
        file_path: filePath,
        name: className,
        line_start: node.startPosition.row + 1,
        line_end: node.endPosition.row + 1,
        language: lang,
        parent_name: null,
        params: null,
        return_type: null,
        modifiers: mods.length ? JSON.stringify(mods) : null,
        is_test: false,
      }),
    );

    // Extract methods from class body
    const body = node.childForFieldName('body');
    if (!body) return;

    for (const member of body.namedChildren) {
      if (member.type !== 'method_definition') continue;

      const methodNameNode = member.childForFieldName('name');
      const methodName = methodNameNode?.text;
      if (!methodName) continue;

      const methodMods: string[] = [];
      // Check for async, static, etc.
      if (member.text.trimStart().startsWith('async ')) methodMods.push('async');
      if (member.text.trimStart().startsWith('static ')) methodMods.push('static');

      // Check accessibility (public/private/protected) via first child text
      for (const child of member.children) {
        if (child.type === 'accessibility_modifier') {
          methodMods.push(child.text);
          break;
        }
      }

      const methodQN = `${filePath}::${className}::${methodName}`;
      const test = isTestFunction(methodName, filePath);

      nodes.push(
        makeNode({
          kind: test ? 'Test' : 'Function',
          qualified_name: methodQN,
          file_path: filePath,
          name: methodName,
          line_start: member.startPosition.row + 1,
          line_end: member.endPosition.row + 1,
          language: lang,
          parent_name: className,
          params: extractParams(member),
          return_type: extractReturnType(member),
          modifiers: methodMods.length ? JSON.stringify(methodMods) : null,
          is_test: test,
        }),
      );

      // CONTAINS edge: class -> method
      edges.push(
        makeEdge({
          source: classQN,
          target: methodQN,
          kind: 'CONTAINS',
          file_path: filePath,
        }),
      );
    }
  });

  return { nodes, edges };
}

export function extractTypes(
  tree: Parser.Tree,
  filePath: string,
  _content: string,
  ext: string,
): GraphNode[] {
  const nodes: GraphNode[] = [];
  const lang = langFromExt(ext);
  const root = tree.rootNode;

  walk(root, (node) => {
    if (node.type !== 'type_alias_declaration' && node.type !== 'interface_declaration') return;

    const nameNode = node.childForFieldName('name');
    const name = nameNode?.text;
    if (!name) return;

    const mods = collectModifiers(node);

    nodes.push(
      makeNode({
        kind: 'Type',
        qualified_name: `${filePath}::${name}`,
        file_path: filePath,
        name,
        line_start: node.startPosition.row + 1,
        line_end: node.endPosition.row + 1,
        language: lang,
        parent_name: null,
        params: null,
        return_type: null,
        modifiers: mods.length ? JSON.stringify(mods) : null,
        is_test: false,
      }),
    );
  });

  return nodes;
}

// ---------------------------------------------------------------------------
// Edge extractors
// ---------------------------------------------------------------------------

export function extractImports(
  tree: Parser.Tree,
  filePath: string,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const root = tree.rootNode;
  const dir = dirname(filePath).replace(/\\/g, '/');

  walk(root, (node) => {
    if (node.type !== 'import_statement') return;

    const sourceNode = node.childForFieldName('source');
    if (!sourceNode) return;

    // Strip quotes from the import path
    const raw = sourceNode.text.replace(/['"]/g, '');

    // Only track relative (internal) imports
    if (!raw.startsWith('.')) return;

    // Normalize the relative import path
    const resolved = posix.normalize(`${dir}/${raw}`);

    edges.push(
      makeEdge({
        source: filePath,
        target: resolved,
        kind: 'IMPORTS_FROM',
        file_path: filePath,
      }),
    );
  });

  return edges;
}

const BUILTIN_FILTER = new Set([
  'console', 'require', 'import', 'setTimeout', 'setInterval', 'clearTimeout',
  'clearInterval', 'Promise', 'Array', 'Object', 'Math', 'JSON', 'String',
  'Number', 'Boolean', 'Date', 'RegExp', 'Error', 'Map', 'Set', 'WeakMap',
  'WeakSet', 'Symbol', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'fetch', 'alert', 'confirm', 'prompt',
]);

const BUILTIN_MEMBER_OBJECTS = new Set([
  'console', 'Math', 'JSON', 'Object', 'Array', 'Promise', 'Number',
  'String', 'Date', 'RegExp', 'Error', 'Symbol',
]);

export function extractCalls(
  tree: Parser.Tree,
  filePath: string,
  knownFunctionNames: Set<string>,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>(); // dedup
  const root = tree.rootNode;

  walk(root, (node) => {
    if (node.type !== 'call_expression') return;

    const fnChild = node.childForFieldName('function');
    if (!fnChild) return;

    let calledName: string | null = null;

    if (fnChild.type === 'identifier') {
      calledName = fnChild.text;
    } else if (fnChild.type === 'member_expression') {
      // e.g. obj.method — extract full text for filtering, use method name for matching
      const obj = fnChild.childForFieldName('object');
      const prop = fnChild.childForFieldName('property');
      if (obj && BUILTIN_MEMBER_OBJECTS.has(obj.text)) return;
      calledName = prop?.text ?? null;
    }

    if (!calledName) return;
    if (BUILTIN_FILTER.has(calledName)) return;
    if (!knownFunctionNames.has(calledName)) return;

    const caller = findEnclosingFunction(node);
    const sourceQN = caller ? `${filePath}::${caller}` : filePath;
    const targetQN = calledName; // best-effort: just the function name

    const edgeKey = `${sourceQN}->${targetQN}`;
    if (seen.has(edgeKey)) return;
    seen.add(edgeKey);

    edges.push(
      makeEdge({
        source: sourceQN,
        target: targetQN,
        kind: 'CALLS',
        file_path: filePath,
      }),
    );
  });

  return edges;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function extractAll(
  tree: Parser.Tree,
  filePath: string,
  content: string,
  ext: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];

  // 1. Functions (standalone + arrow)
  const { nodes: fnNodes, names: fnNames } = extractFunctions(tree, filePath, content, ext);
  allNodes.push(...fnNodes);

  // 2. Classes + their methods
  const { nodes: classNodes, edges: classEdges } = extractClasses(tree, filePath, content, ext);
  allNodes.push(...classNodes);
  allEdges.push(...classEdges);

  // Add class method names to the known set
  for (const n of classNodes) {
    if (n.kind === 'Function' || n.kind === 'Test') {
      fnNames.add(n.name);
    }
  }

  // 3. Types & interfaces
  const typeNodes = extractTypes(tree, filePath, content, ext);
  allNodes.push(...typeNodes);

  // 4. Import edges
  const importEdges = extractImports(tree, filePath);
  allEdges.push(...importEdges);

  // 5. Call edges
  const callEdges = extractCalls(tree, filePath, fnNames);
  allEdges.push(...callEdges);

  return { nodes: allNodes, edges: allEdges };
}
