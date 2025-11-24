# Lyra

Lyra is a lightweight engine for building **precomputed, faceted index bundles** from structured data.

You use it to:

- Build a snapshot of your data offline or in CI.
- Ship that snapshot as JSON (or a more compact format later).
- Load it anywhere (browser, server, edge, mobile) and run **fast, deterministic queries**.
- Expose it to LLM agents as a **structured tool** for precise, attribute-based retrieval.

Lyra is not a vector database, not a warehouse, and not a generic search engine. It is a **portable, manifest-driven context layer** for agents and applications.


## Why Lyra?

Modern stacks tend to polarize:

- Heavy online infra (warehouses, vector DBs, OLAP) for analytics and RAG.
- Ad hoc client-side filtering (array `.filter`, one-off search libs) for each UI.

Lyra fills the gap between those:

- **Deterministic snapshots**: The same inputs always produce the same bundle and the same answers.
- **Structured retrieval**: Exact facet and range queries instead of approximate semantic matches.
- **Environment-agnostic**: Works in Node, browsers, serverless, and edge runtimes.
- **Agent-native**: Bundles are self-describing and easy to expose as tools to LLM agents.


## Features

- **Precomputed bundles**  
  Build once from your structured data, then reuse the bundle everywhere.

- **Faceted filtering**  
  Fast equality filters on fields like `status`, `priority`, `region`, `product`, etc.

- **Range queries**  
  Filter by numeric or date ranges (`amount`, `createdAt`, `timestamp`, …).

- **Manifest-driven**  
  Each bundle includes a manifest describing:
  - fields and their types,
  - which are facets vs ranges,
  - snapshot metadata (dataset ID, build time, format version).

- **Deterministic & testable**  
  Queries over a given bundle are exact and reproducible, which makes debugging and verification straightforward.

- **Zero runtime ML cost**  
  No embeddings or models at query time. Just precomputed indexes and primitive operations.


## When to use Lyra

Lyra is a good fit when you:

- Have **structured or semi-structured records** (tickets, projects, events, sensors, etc.).
- Want **instant filters / drilldowns** in dashboards without shipping raw tables to the client.
- Need **offline / edge / browser** retrieval without relying on live warehouses or vector stores.
- Want to give **LLM agents** a deterministic, inspectable view of world state they can query as a tool.

It is **not** a replacement for:

- Full-text search across arbitrary documents.
- Semantic similarity search over large unstructured corpora.
- Real-time, strongly-consistent transactional databases.

You can combine Lyra with those when needed.


## Installation

```bash
npm install lyra
# or
yarn add lyra
# or
pnpm add lyra
# or
bun add lyra
```


## Core concepts

### Bundle

A **bundle** is the main artifact Lyra works with. It consists of:

- A **manifest** describing the dataset, fields, and capabilities.
- Precomputed **indexes** for facets and ranges.
- Optionally, a compact representation of the items themselves.

You typically:

1. Build a bundle offline (CI, build step, backend job).
2. Persist it (filesystem, object storage, CDN).
3. Load and query it in your app or agent.

### Manifest

The manifest is a JSON description embedded in the bundle. It includes:

- `datasetId`: logical name or ID for the dataset.
- `builtAt`: snapshot timestamp.
- `fields`: list of fields, their types, and roles (facet/range/meta).
- `capabilities`: which fields can be faceted, ranged, or searched.

Example (simplified):

```json
{
  "version": "1.0.0",
  "datasetId": "tickets-2025-11-22",
  "builtAt": "2025-11-22T03:14:00Z",
  "fields": [
    { "name": "id",           "kind": "id",    "type": "string", "ops": ["eq"] },
    { "name": "customer",     "kind": "facet", "type": "string", "ops": ["eq", "in"] },
    { "name": "priority",     "kind": "facet", "type": "string", "ops": ["eq", "in"] },
    { "name": "status",       "kind": "facet", "type": "string", "ops": ["eq", "in"] },
    { "name": "productArea",  "kind": "facet", "type": "string", "ops": ["eq", "in"] },
    { "name": "createdAt",    "kind": "range", "type": "date",   "ops": ["between", "gte", "lte"] }
  ],
  "capabilities": {
    "facets": ["customer", "priority", "status", "productArea"],
    "ranges": ["createdAt"]
  }
}
```

### Query and result

Lyra’s query model is simple and agent-friendly:

```ts
type FacetFilter = Record<string, unknown | unknown[]>;
type RangeFilter = Record<string, { min?: number; max?: number }>;

interface LyraQuery {
  facets?: FacetFilter;
  ranges?: RangeFilter;
  limit?: number;
  offset?: number;
}

interface FacetCounts {
  [field: string]: Record<string, number>;
}

interface LyraSnapshotInfo {
  datasetId: string;
  builtAt: string;
  indexVersion: string;
}

interface LyraResult<Item = unknown> {
  items: Item[];
  total: number;
  applied: {
    facets?: FacetFilter;
    ranges?: RangeFilter;
  };
  facets?: FacetCounts; // optional facet counts for drilldown
  snapshot: LyraSnapshotInfo;
}
```


## Quick start

### 1. Build a bundle from your data

You typically do this in a build step or backend process.

```ts
import { createBundle } from 'lyra';

type Ticket = {
  id: string;
  customer: string;
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'in_progress' | 'closed';
  productArea: string;
  createdAt: string; // ISO date
};

const tickets: Ticket[] = [
  {
    id: 'T-1001',
    customer: 'Acme Corp',
    priority: 'high',
    status: 'open',
    productArea: 'analytics',
    createdAt: '2025-11-20T10:15:00Z',
  },
  {
    id: 'T-1002',
    customer: 'Acme Corp',
    priority: 'medium',
    status: 'in_progress',
    productArea: 'core',
    createdAt: '2025-11-19T08:30:00Z',
  },
  // ...
];

const bundle = await createBundle<Ticket>(tickets, {
  datasetId: 'tickets-2025-11-22',
  fields: {
    id:          { kind: 'id',    type: 'string' },
    customer:    { kind: 'facet', type: 'string' },
    priority:    { kind: 'facet', type: 'string' },
    status:      { kind: 'facet', type: 'string' },
    productArea: { kind: 'facet', type: 'string' },
    createdAt:   { kind: 'range', type: 'date' },
  },
});

// Serialize and persist bundle (JSON for v1)
const json = JSON.stringify(bundle.toJSON());
// Save `json` where your app/agent can fetch it (S3, GCS, filesystem, CDN, etc.)
```

### 2. Load and query the bundle at runtime

In your app, server, or edge function:

```ts
import { loadBundle, type LyraQuery, type LyraResult } from 'lyra';

// Load previously stored JSON (string or plain object)
const stored = await fetch('/data/tickets-bundle.json').then((r) => r.json());

const bundle = loadBundle<Ticket>(stored);

// Define a query: high-priority open tickets for Acme in analytics
const query: LyraQuery = {
  facets: {
    customer: 'Acme Corp',
    priority: 'high',
    status: 'open',
    productArea: 'analytics',
  },
  limit: 50,
};

const result: LyraResult<Ticket> = bundle.query(query);

console.log(result.total); // e.g. 1
console.log(result.items);
/*
[
  {
    id: 'T-1001',
    customer: 'Acme Corp',
    priority: 'high',
    status: 'open',
    productArea: 'analytics',
    createdAt: '2025-11-20T10:15:00Z',
  }
]
*/

// Snapshot metadata is always included
console.log(result.snapshot);
/*
{
  datasetId: 'tickets-2025-11-22',
  builtAt: '2025-11-22T03:14:00Z',
  indexVersion: '1.0.0'
}
*/
```


## Using Lyra with an LLM agent (outline)

Lyra is designed to be wrapped as a tool.

A minimal conceptual pattern:

```ts
import { loadBundle, type LyraQuery, type LyraResult } from 'lyra';

// Somewhere in your agent setup:
const ticketsBundle = loadBundle<Ticket>(storedBundle);

async function lyraTicketsTool(args: LyraQuery): Promise<LyraResult<Ticket>> {
  // In real code you should validate args against the manifest
  return ticketsBundle.query(args);
}
```

When defining tools for your agent framework (e.g., OpenAI tool calling), you can:

- Auto-generate the tool schema from `bundle.describe()` (the manifest).
- Let the model choose facets and ranges based on the manifest’s field list.

The agent can then:

- Call `lyraTicketsTool` with specific facet/range filters.
- Use `total` and `facets` in the result to decide whether to refine or broaden queries.
- Rely on `snapshot` to understand the recency and identity of the data.


## API (v1 draft)

Lyra’s v1 API is intentionally small.

### `createBundle<T>(items, config)`

Builds a bundle from an array of items.

```ts
interface FieldConfig {
  kind: 'id' | 'facet' | 'range' | 'meta';
  type: 'string' | 'number' | 'boolean' | 'date';
}

interface CreateBundleConfig {
  datasetId: string;
  fields: Record<string, FieldConfig>;
}

declare function createBundle<T>(
  items: T[],
  config: CreateBundleConfig
): Promise<LyraBundle<T>>;
```

### `loadBundle<T>(raw)`

Loads a bundle from a previously serialized JSON representation.

```ts
declare function loadBundle<T>(raw: unknown): LyraBundle<T>;
```

### `class LyraBundle<T>`

Core runtime object.

```ts
class LyraBundle<T> {
  query(q: LyraQuery): LyraResult<T>;
  describe(): LyraManifest;
  snapshot(): LyraSnapshotInfo;
  toJSON(): unknown; // for serialization
}
```

Types:

```ts
type LyraManifest = {
  version: string;
  datasetId: string;
  builtAt: string;
  fields: {
    name: string;
    kind: 'id' | 'facet' | 'range' | 'meta';
    type: 'string' | 'number' | 'boolean' | 'date';
    ops: Array<'eq' | 'in' | 'between' | 'gte' | 'lte'>;
  }[];
  capabilities: {
    facets: string[];
    ranges: string[];
  };
};
```


## Status and roadmap

Lyra is early-stage.

Near-term focus:

- Solidify the manifest and query model.
- Optimize in-memory index structures for medium-sized datasets.
- Add small utilities for:
  - schema inspection and diagnostics,
  - basic facet counts in `LyraResult`.

Future directions:

- Optional binary format for faster load times and smaller bundles.
- Segment support for very large datasets.
- CLI for building, inspecting, and validating bundles.
- First-class agent integration helpers (tool schema generation, validations).
