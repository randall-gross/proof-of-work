import { DatabaseSync } from 'node:sqlite';
import type { GraphNode, GraphEdge } from './types.js';

const SCHEMA_DDL = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 30000;

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER);
INSERT OR IGNORE INTO schema_version VALUES (1);

CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  qualified_name TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL,
  name TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  language TEXT NOT NULL,
  parent_name TEXT,
  params TEXT,
  return_type TEXT,
  modifiers TEXT,
  is_test INTEGER NOT NULL DEFAULT 0,
  file_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source, target, kind)
);

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(qualified_name);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);
`;

interface NodeRow {
  id: number;
  kind: string;
  qualified_name: string;
  file_path: string;
  name: string;
  line_start: number;
  line_end: number;
  language: string;
  parent_name: string | null;
  params: string | null;
  return_type: string | null;
  modifiers: string | null;
  is_test: number;
  file_hash: string;
  updated_at: string;
}

interface EdgeRow {
  id: number;
  source: string;
  target: string;
  kind: string;
  file_path: string;
  updated_at: string;
}

function rowToNode(row: NodeRow): GraphNode {
  return {
    id: row.id,
    kind: row.kind as GraphNode['kind'],
    qualified_name: row.qualified_name,
    file_path: row.file_path,
    name: row.name,
    line_start: row.line_start,
    line_end: row.line_end,
    language: row.language,
    parent_name: row.parent_name,
    params: row.params,
    return_type: row.return_type,
    modifiers: row.modifiers,
    is_test: row.is_test !== 0,
    file_hash: row.file_hash,
    updated_at: row.updated_at,
  };
}

function rowToEdge(row: EdgeRow): GraphEdge {
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    kind: row.kind as GraphEdge['kind'],
    file_path: row.file_path,
    updated_at: row.updated_at,
  };
}

export class GraphStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA_DDL);
  }

  upsertNode(node: GraphNode): void {
    const stmt = this.db.prepare(`
      INSERT INTO nodes
        (kind, qualified_name, file_path, name, line_start, line_end, language,
         parent_name, params, return_type, modifiers, is_test, file_hash, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(qualified_name) DO UPDATE SET
        kind        = excluded.kind,
        file_path   = excluded.file_path,
        name        = excluded.name,
        line_start  = excluded.line_start,
        line_end    = excluded.line_end,
        language    = excluded.language,
        parent_name = excluded.parent_name,
        params      = excluded.params,
        return_type = excluded.return_type,
        modifiers   = excluded.modifiers,
        is_test     = excluded.is_test,
        file_hash   = excluded.file_hash,
        updated_at  = excluded.updated_at
    `);
    stmt.run(
      node.kind,
      node.qualified_name,
      node.file_path,
      node.name,
      node.line_start,
      node.line_end,
      node.language,
      node.parent_name ?? null,
      node.params ?? null,
      node.return_type ?? null,
      node.modifiers ?? null,
      node.is_test ? 1 : 0,
      node.file_hash,
      node.updated_at,
    );
  }

  upsertEdge(edge: GraphEdge): void {
    const stmt = this.db.prepare(`
      INSERT INTO edges (source, target, kind, file_path, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source, target, kind) DO UPDATE SET
        file_path  = excluded.file_path,
        updated_at = excluded.updated_at
    `);
    stmt.run(edge.source, edge.target, edge.kind, edge.file_path, edge.updated_at);
  }

  deleteFileNodes(filePath: string): void {
    this.db.prepare('DELETE FROM nodes WHERE file_path = ?').run(filePath);
    this.db.prepare('DELETE FROM edges WHERE file_path = ?').run(filePath);
  }

  getNodesByFile(filePath: string): GraphNode[] {
    const rows = this.db
      .prepare('SELECT * FROM nodes WHERE file_path = ?')
      .all(filePath) as NodeRow[];
    return rows.map(rowToNode);
  }

  getNodeByName(qualifiedName: string): GraphNode | null {
    const row = this.db
      .prepare('SELECT * FROM nodes WHERE qualified_name = ?')
      .get(qualifiedName) as NodeRow | undefined;
    return row ? rowToNode(row) : null;
  }

  getEdges(opts?: { source?: string; target?: string; kind?: string }): GraphEdge[] {
    const conditions: string[] = [];
    const params: string[] = [];

    if (opts?.source !== undefined) {
      conditions.push('source = ?');
      params.push(opts.source);
    }
    if (opts?.target !== undefined) {
      conditions.push('target = ?');
      params.push(opts.target);
    }
    if (opts?.kind !== undefined) {
      conditions.push('kind = ?');
      params.push(opts.kind);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM edges ${where}`)
      .all(...params) as EdgeRow[];
    return rows.map(rowToEdge);
  }

  getAllNodes(): GraphNode[] {
    const rows = this.db.prepare('SELECT * FROM nodes').all() as NodeRow[];
    return rows.map(rowToNode);
  }

  getAllEdges(): GraphEdge[] {
    const rows = this.db.prepare('SELECT * FROM edges').all() as EdgeRow[];
    return rows.map(rowToEdge);
  }

  getStats(): {
    total_nodes: number;
    total_edges: number;
    files_count: number;
    last_updated: string | null;
  } {
    const nodeCount = this.db
      .prepare('SELECT COUNT(*) as count FROM nodes')
      .get() as { count: number };
    const edgeCount = this.db
      .prepare('SELECT COUNT(*) as count FROM edges')
      .get() as { count: number };
    const fileCount = this.db
      .prepare('SELECT COUNT(DISTINCT file_path) as count FROM nodes')
      .get() as { count: number };
    const lastUpdatedMeta = this.getMetadata('last_updated');

    return {
      total_nodes: nodeCount.count,
      total_edges: edgeCount.count,
      files_count: fileCount.count,
      last_updated: lastUpdatedMeta,
    };
  }

  setMetadata(key: string, value: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)')
      .run(key, value);
  }

  getMetadata(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM metadata WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  close(): void {
    this.db.close();
  }
}
