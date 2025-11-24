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
  Fast equality filters on fields like `status`, `priority`, `region`, `product`, etc. Facet fields may be single values or arrays of values; array fields are treated as "matches if any value matches".

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

- **Practical performance profile**  
  Lyra is optimized for sub-millisecond facet queries over medium-sized datasets (tens to low hundreds of thousands of records) on a single machine or runtime. It trades some build-time and memory for very fast filter intersections at query time.


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
npm install @vectoral/lyra
# or
yarn add @vectoral/lyra
# or
pnpm add @vectoral/lyra
# or
bun add @vectoral/lyra
```


## Core concepts

### Bundle

A **bundle** is the main artifact Lyra works with. It consists of:

- A **manifest** describing the dataset, fields, and capabilities.
- Precomputed **indexes** for facets and ranges.
- The bundle currently stores items as a plain array; future versions may add more compact representations for large datasets.

You typically:

1. Build a bundle offline (CI, build step, backend job).
2. Persist it (filesystem, object storage, CDN).
3. Load and query it in your app or agent.

### Manifest

The manifest is a JSON description embedded in the bundle. It includes:

- `datasetId`: logical name or ID for the dataset.
- `builtAt`: snapshot timestamp.
- `fields`: list of fields, their types, and roles (facet/range/meta).
- `capabilities`: which fields can be faceted or ranged.

#### Field kinds

Each field in the manifest has a `kind` that determines how it's used:

- **`id`**: Identifier field; currently informational for the manifest. It is stored in the items like any other field and is not specially indexed in v1.
- **`facet`**: Indexed for equality and IN filters. Values are stored in a posting list index for fast intersection.
- **`range`**: Considered in numeric/date range filters. Values are checked at query time against min/max bounds.
- **`meta`**: Included in the manifest for schema awareness, but not indexed. Useful for agent/tool descriptions and documentation.

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

The `ops` array on each field is descriptive metadata generated from the `kind` (facet vs range). It documents which operations are meaningful for that field but does not change query semantics in v1.

### Query and result

Lyra's query model is simple and agent-friendly:

```ts
type FacetPrimitive = string | number | boolean;
type FacetValue = FacetPrimitive | FacetPrimitive[];

interface RangeFilter {
  min?: number;
  max?: number;
}

interface LyraQuery {
  facets?: Record<string, FacetValue>;
  ranges?: Record<string, RangeFilter>;
  limit?: number;
  offset?: number;
  includeFacetCounts?: boolean;
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
    facets?: LyraQuery['facets'];
    ranges?: LyraQuery['ranges'];
  };
  facets?: FacetCounts; // optional facet counts for drilldown
  snapshot: LyraSnapshotInfo;
}
```

#### Range semantics

Range queries work differently depending on the field type:

- **For `type: 'number'`**: Lyra compares the numeric value directly.
- **For `type: 'date'`**: Lyra attempts to parse the field using `Date.parse(value)` and compares the resulting timestamp (milliseconds since Unix epoch).
- **Query `min`/`max` values are always numbers**. For fields declared as `type: 'date'`, these numbers are interpreted as Unix timestamps in milliseconds (e.g. from `Date.now()` or `new Date().getTime()`).
- **Items with unparseable date values are excluded** from range results.

Example:

```ts
const now = Date.now();
const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

const query: LyraQuery = {
  ranges: {
    createdAt: { min: oneWeekAgo, max: now },
  },
};
```

For how malformed or unknown fields are handled, see [Error Behavior](#error-behavior).


## Quick start

### 1. Build a bundle from your data

You typically do this in a build step or backend process.

```ts
import { createBundle } from '@vectoral/lyra';

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

const bundle = await createBundle(tickets, {
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
import { LyraBundle, type LyraQuery, type LyraResult } from '@vectoral/lyra';

// Load previously stored JSON (string or plain object)
const stored = await fetch('/data/tickets-bundle.json').then((r) => r.json());

const bundle = LyraBundle.load<Ticket>(stored);

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
import { LyraBundle, type LyraQuery, type LyraResult } from '@vectoral/lyra';

// Somewhere in your agent setup:
const ticketsBundle = LyraBundle.load<Ticket>(storedBundle);

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


## Public API

Lyra’s v1 API is intentionally small and stable.

### Core Functions

#### `createBundle<T>(items, config)`

Builds a bundle from an array of items.

```ts
declare function createBundle<T extends Record<string, unknown>>(
  items: T[],
  config: CreateBundleConfig<T>
): Promise<LyraBundle<T>>;
```

#### `class LyraBundle<T>`

Core runtime object for querying bundles.

```ts
class LyraBundle<T extends Record<string, unknown>> {
  // Execute a query against the bundle
  query(q: LyraQuery): LyraResult<T>;
  
  // Get the bundle manifest
  describe(): LyraManifest;
  
  // Get snapshot metadata
  snapshot(): LyraSnapshotInfo;
  
  // Serialize to a plain JSON-compatible structure
  toJSON(): LyraBundleJSON<T>;
  
  // Load a bundle from serialized JSON
  static load<TItem extends Record<string, unknown>>(
    raw: LyraBundleJSON<TItem>
  ): LyraBundle<TItem>;
}
```

`toJSON()` returns a plain, JSON-compatible structure; it does not include any methods or prototype data.

### Type Definitions

#### `CreateBundleConfig<TItem>`

Bundle configuration for a given item type. The generic parameter ensures compile-time field name validation.

```ts
interface FieldDefinition {
  kind: 'id' | 'facet' | 'range' | 'meta';
  type: 'string' | 'number' | 'boolean' | 'date';
}

interface CreateBundleConfig<TItem extends Record<string, unknown>> {
  datasetId: string;
  fields: {
    [K in Extract<keyof TItem, string>]?: FieldDefinition;
  };
}
```

Example with type safety:

```ts
type Ticket = { id: string; status: string };

const config: CreateBundleConfig<Ticket> = {
  datasetId: 'tickets',
  fields: {
    status: { kind: 'facet', type: 'string' },
    // @ts-expect-error: Property 'stauts' does not exist on type 'Ticket'
    stauts: { kind: 'facet', type: 'string' },
  },
};
```

#### `LyraQuery`

`LyraQuery` is defined in [Query and result](#query-and-result). It supports:

- facet filters (`facets`)
- range filters (`ranges`)
- pagination (`limit`, `offset`)
- optional facet counts (`includeFacetCounts`)

#### `LyraResult<T>`

`LyraResult<T>` is defined in [Query and result](#query-and-result) and wraps:

- the matching items,
- the total count,
- the applied query,
- optional facet counts, and
- snapshot metadata.

#### Other Types

- `LyraManifest` - Bundle manifest describing fields and capabilities
- `LyraSnapshotInfo` - Snapshot metadata (datasetId, builtAt, indexVersion)
- `LyraBundleJSON<T>` - On-the-wire JSON structure for a bundle
- `FieldKind` - `'id' | 'facet' | 'range' | 'meta'`
- `FieldType` - `'string' | 'number' | 'boolean' | 'date'`
- `FieldDefinition` - Field configuration object
- `FacetCounts` - Aggregated facet counts for a result set

## Error Behavior

### `createBundle` / `LyraBundle.create`

**Throws** synchronously/asynchronously with `Error` in these cases:

- **Invalid field config:**
  - `kind` not in `['id','facet','range','meta']`
  - `type` not in `['string','number','boolean','date']`
  - Error message: `Invalid field kind "foo" for field "status". Must be one of: id, facet, range, meta.`

**Soft behavior:**

- If a configured field does not exist on any item:
  - Does not throw
  - Emits a `console.warn` exactly once per field: `Field "statusBucket" is configured but does not exist in any items. It will be ignored.`

### `LyraBundle.load`

**Throws** for clearly invalid bundle structures:

- Missing manifest or items: `Invalid bundle JSON: missing manifest or items`
- Invalid manifest version: `Invalid bundle version: "2.0.0". Expected version starting with "1."`
- Capabilities reference unknown fields: `Invalid bundle: capability references non-existent facet field "status"`
- facetIndex contains keys not declared as facet capabilities: `Invalid bundle: facetIndex contains field "priority" that is not in capabilities.facets`

**Does not throw** for:
- Missing facet field entries in facetIndex (initializes to `{}` and continues)

### `LyraBundle.query`

**Query normalization and error handling:**

- **Unknown facet field:** Treated as "no matches" (returns `total = 0`, `items = []`)
- **Unknown range field:** Treated as "no matches" (returns `total = 0`, `items = []`)
- **Negative offset:** Clamped to `0`
- **Negative limit:** Treated as `0` (no items returned, but `total` still reflects all matches)
- **Overly large limit:** Effectively clamped to `candidateIndices.length` via `.slice()`

This behavior is intentional: a typo in a facet or range field name will fail closed (no matches) rather than silently ignore the filter.

All of these behaviors are deterministic and documented. Bad types in query parameters are out of scope for v1; callers are expected to pass structurally correct types.


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
