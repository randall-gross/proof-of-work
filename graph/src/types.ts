export type NodeKind = 'File' | 'Function' | 'Class' | 'Type' | 'Test';
export type EdgeKind = 'CALLS' | 'IMPORTS_FROM' | 'INHERITS' | 'IMPLEMENTS' | 'CONTAINS' | 'TESTED_BY' | 'DEPENDS_ON';

export interface GraphNode {
  id?: number;
  kind: NodeKind;
  qualified_name: string;  // file_path::ClassName::methodName
  file_path: string;
  name: string;
  line_start: number;
  line_end: number;
  language: string;
  parent_name: string | null;
  params: string | null;
  return_type: string | null;
  modifiers: string | null;  // JSON array: ["export", "async"]
  is_test: boolean;
  file_hash: string;
  updated_at: string;
}

export interface GraphEdge {
  id?: number;
  source: string;  // qualified_name
  target: string;  // qualified_name
  kind: EdgeKind;
  file_path: string;
  updated_at: string;
}

export interface BuildResult {
  files_parsed: number;
  total_nodes: number;
  total_edges: number;
  errors: string[];
  changed_files: string[];
}

export interface ImpactResult {
  changed_nodes: GraphNode[];
  impacted_nodes: GraphNode[];
  impacted_files: string[];
  edges: GraphEdge[];
  truncated: boolean;
  total_impacted: number;
}
