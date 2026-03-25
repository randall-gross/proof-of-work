import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { GraphStore } from './store.js';
import * as parser from './parser.js';
import { handleBuildGraph } from './tools/build-graph.js';
import { handleGraphStats } from './tools/graph-stats.js';
import { handleQueryGraph } from './tools/query-graph.js';
import { handleImpactRadius } from './tools/impact-radius.js';

// ---------------------------------------------------------------------------
// Lazy-initialized singletons
// ---------------------------------------------------------------------------

let store: GraphStore | null = null;
let parserReady = false;

async function getStore(): Promise<GraphStore> {
  if (!store) {
    const dbDir = resolve(process.cwd(), '.proof-of-work');
    mkdirSync(dbDir, { recursive: true });
    const dbPath = resolve(dbDir, 'graph.db');
    store = new GraphStore(dbPath);
  }

  if (!parserReady) {
    await parser.init();
    parserReady = true;
  }

  return store;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'pow-graph', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// ---------------------------------------------------------------------------
// Tool list
// ---------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'pow_build_graph',
      description:
        'Build or update the code knowledge graph. Full rebuild parses all files; incremental (default) only re-parses changed files.',
      inputSchema: {
        type: 'object',
        properties: {
          full_rebuild: {
            type: 'boolean',
            description: 'Force full rebuild instead of incremental',
            default: false,
          },
          repo_root: {
            type: 'string',
            description: 'Repository root path (defaults to cwd)',
          },
        },
      },
    },
    {
      name: 'pow_query_graph',
      description:
        'Query the code graph for relationships between functions, classes, and files.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            enum: [
              'callers_of',
              'callees_of',
              'imports_of',
              'importers_of',
              'tests_for',
              'file_summary',
            ],
            description: 'Query pattern',
          },
          target: {
            type: 'string',
            description: 'Target qualified name or file path',
          },
        },
        required: ['pattern', 'target'],
      },
    },
    {
      name: 'pow_impact_radius',
      description:
        'Compute the blast radius of changes — what files and functions are affected.',
      inputSchema: {
        type: 'object',
        properties: {
          changed_files: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of changed file paths',
          },
          max_depth: {
            type: 'number',
            description: 'Maximum BFS depth (default 2)',
            default: 2,
          },
        },
        required: ['changed_files'],
      },
    },
    {
      name: 'pow_graph_stats',
      description:
        'Get graph health stats — node/edge counts, file count, last updated timestamp.',
      inputSchema: {
        type: 'object',
        properties: {
          repo_root: {
            type: 'string',
            description: 'Repository root path (defaults to cwd)',
          },
        },
      },
    },
  ],
}));

// ---------------------------------------------------------------------------
// Tool call router
// ---------------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const s = await getStore();

  switch (name) {
    case 'pow_build_graph':
      return handleBuildGraph(s, args as { full_rebuild?: boolean; repo_root?: string });

    case 'pow_graph_stats':
      return handleGraphStats(s);

    case 'pow_query_graph':
      return handleQueryGraph(s, args as { pattern: string; target: string });

    case 'pow_impact_radius':
      return handleImpactRadius(s, args as { changed_files: string[]; max_depth?: number });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
