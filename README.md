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

**Bundle format specification:** The normative specification of the Lyra bundle JSON format lives in [`docs/bundle-json-spec.md`](./docs/bundle-json-spec.md). The `LyraBundle.toJSON()` method serializes bundles to this format, and `LyraBundle.load()` reads bundles from this format. Any change to these methods must be reflected in that document.

### Manifest

The manifest is a JSON description embedded in the bundle. It includes:

- `datasetId`: logical name or ID for the dataset.
- `builtAt`: snapshot timestamp.
- `fields`: list of fields, their types, and roles (facet/range/meta).
- `capabilities`: which fields can be faceted or ranged. **The `capabilities` object is the authoritative source of truth for queryable fields.** Only fields listed in `capabilities.facets` can be used in facet filters, and only fields listed in `capabilities.ranges` can be used in range filters.

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

// Explicit config style (full control)
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

// Simple config style (ergonomic, with type inference)
const bundleSimple = await createBundle(tickets, {
  datasetId: 'tickets-2025-11-22',
  id: 'id', // optional; will auto-detect 'id'/'Id'/'ID' if omitted
  facets: ['customer', 'priority', 'status', 'productArea'],
  ranges: ['createdAt'],
  // autoMeta: true, // default: auto-add remaining simple fields as meta
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

// For dashboard filtering: request facet counts for drilldown UI
const dashboardQuery: LyraQuery = {
  facets: {
    customer: 'Acme Corp',
  },
  includeFacetCounts: true, // Enable facet counts
};

const dashboardResult = bundle.query(dashboardQuery);
console.log(dashboardResult.facets);
/*
{
  status: { open: 5, closed: 3 },
  priority: { high: 2, medium: 4, low: 2 },
  productArea: { analytics: 3, core: 5 }
}
*/
```


## Configuration modes

Lyra supports two configuration styles: **explicit fields config** and **simple config**. Choose based on your needs.

### Explicit fields config

Use when you need **strict control** and **long-lived schemas**.

- Full control over field kinds (`id`, `facet`, `range`, `meta`) and types (`string`, `number`, `boolean`, `date`)
- Explicitly declare every field you want in the manifest
- Best for production systems where schema stability matters

```ts
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
```

### Simple config

Use when you want **quick value** with **minimal boilerplate**.

- Specify fields by purpose (`id`, `facets`, `ranges`, `meta`)
- Types are inferred automatically from the data
- `autoMeta: true` (default) automatically adds remaining simple fields as meta
- Best for prototyping, one-off scripts, or when you want schema discovery

```ts
const bundle = await createBundle(tickets, {
  datasetId: 'tickets-2025-11-22',
  id: 'id', // optional; will auto-detect 'id'/'Id'/'ID' if omitted
  facets: ['customer', 'priority', 'status', 'productArea'],
  ranges: ['createdAt'],
  // autoMeta: true, // default: auto-add remaining simple fields as meta
});
```

**Auto-meta behavior:**

By default (`autoMeta: true`), any remaining primitive fields that are not configured as id, facet, or range are automatically added to the manifest as meta fields. This makes the full record shape visible to agents and tooling while keeping the index focused.

- **Simple fields** (primitives and arrays of primitives) are auto-added as meta
- **Nested/complex fields** (objects, nested structures) are silently skipped
- Set `autoMeta: false` to disable this behavior for wide or messy schemas

```ts
// Disable auto-meta for wide tables
const bundle = await createBundle(wideTable, {
  datasetId: 'wide',
  facets: ['status'],
  autoMeta: false, // Only explicitly configured fields will appear
});
```

See [`examples/basic-usage/`](./examples/basic-usage/) for side-by-side examples of both configuration styles.


## Using Lyra with an LLM agent

Lyra is designed to be wrapped as a tool for LLM agents. Here's a complete integration pattern:

```ts
import {
  LyraBundle,
  buildOpenAiTool,
  type LyraQuery,
  type LyraResult,
} from '@vectoral/lyra';

// Load bundle at startup
const ticketsBundle = LyraBundle.load<Ticket>(storedBundle);

// Tool function that the agent will call
async function lyraTicketsTool(args: LyraQuery): Promise<LyraResult<Ticket>> {
  return ticketsBundle.query(args);
}

// Generate tool schema for OpenAI (or other frameworks)
const tool = buildOpenAiTool(ticketsBundle.describe(), {
  name: 'queryTickets',
  description: 'Query support tickets using facet and range filters',
});

// Pass to your agent framework
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  tools: [tool],
  // ...
});
```

**Key points:**

- Use `buildOpenAiTool(bundle.describe(), options)` to auto-generate the tool schema from the manifest
- The generated schema is derived from `capabilities.facets` and `capabilities.ranges`, ensuring it matches what Lyra actually supports
- The agent can call the tool function with facet/range filters based on the manifest's capabilities
- Use `total` and `facets` in the result to help the agent refine or broaden queries
- The `snapshot` metadata helps the agent understand data recency and identity

See [`examples/agent-tool/`](./examples/agent-tool/) for a complete working example.


## Dashboards & facet UIs

Lyra provides two patterns for building dashboard dropdowns and drilldown UIs:

### Pattern 1: Raw query with `includeFacetCounts`

Get facet counts for all fields at once:

```ts
const result = bundle.query({
  facets: {
    customerId: 'C-ACME', // Current filter
  },
  includeFacetCounts: true,
});

// result.facets contains counts for all facet fields
console.log(result.facets?.status); // { open: 5, closed: 3, ... }
console.log(result.facets?.priority); // { high: 2, medium: 4, ... }
```

### Pattern 2: `getFacetSummary` for single-field summaries

Get distinct values and counts for a specific facet field:

```ts
// What floors exist? (global query, no filters)
const floorsSummary = bundle.getFacetSummary('floor');
// { field: 'floor', values: [{ value: '1', count: 10 }, { value: '2', count: 8 }, ...] }

// What floors exist under current filters?
const filteredFloorsSummary = bundle.getFacetSummary('floor', {
  facets: { customerId: 'C-ACME', status: 'open' },
});
// Counts reflect only items matching the filters
```

**Important notes:**

- **Only facet fields are supported** (`capabilities.facets`). Date fields are ranges and cannot be summarized with `getFacetSummary`.
- **Counts respect any filters you pass** - they reflect the post-filtered candidate set, perfect for drilldown UIs.
- **`null`/`undefined` values are excluded** from counts (consistent with query behavior).
- **Arrays contribute one count per element** (including duplicates). For example, an item with `tags: ['a', 'a', 'b']` contributes `'a': 2` and `'b': 1` to the counts.
- Values are returned in sorted order (numbers ascending, booleans false-then-true, strings lexicographic).


## Public API

Lyra’s v1 API is intentionally small and stable.

### Core Functions

#### `createBundle<T>(items, config)`

Builds a bundle from an array of items. Supports both explicit and simple configuration styles.

```ts
// Explicit config (full control)
declare function createBundle<T extends Record<string, unknown>>(
  items: T[],
  config: CreateBundleConfig<T>
): Promise<LyraBundle<T>>;

// Simple config (ergonomic, with type inference)
declare function createBundle<T extends Record<string, unknown>>(
  items: T[],
  config: SimpleBundleConfig<T>
): Promise<LyraBundle<T>>;
```

#### `class LyraBundle<T>`

Core runtime object for querying bundles.

```ts
class LyraBundle<T extends Record<string, unknown>> {
  // Execute a query against the bundle
  query(q: LyraQuery): LyraResult<T>;
  
  // Get facet summary for a single field (dashboard-friendly)
  getFacetSummary(
    field: string,
    options?: { facets?: LyraQuery['facets']; ranges?: LyraQuery['ranges'] }
  ): { field: string; values: Array<{ value: string | number | boolean; count: number }> };
  
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

Explicit bundle configuration for a given item type. The generic parameter ensures compile-time field name validation.

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

#### `SimpleBundleConfig<TItem>`

Simple, ergonomic bundle configuration that infers types automatically. This config style allows you to specify fields by purpose (id, facets, ranges, meta) rather than requiring full field definitions.

```ts
interface SimpleBundleConfig<TItem extends Record<string, unknown>> {
  datasetId: string;
  /** Explicit ID field name. If omitted, will auto-detect from 'id'/'Id'/'ID'. */
  id?: FieldName<TItem>;
  /** Fields to index as facets (for equality filtering). */
  facets?: FieldName<TItem>[];
  /** Fields to index as ranges (for numeric/date range filtering). */
  ranges?: FieldName<TItem>[];
  /** Fields to include in manifest as meta (non-indexed, schema-visible). */
  meta?: FieldName<TItem>[];
  /** How aggressively to infer field types. Default: 'runtime'. */
  inferTypes?: 'none' | 'runtime';
  /** Whether to auto-add remaining simple fields as meta. Default: true. */
  autoMeta?: boolean;
}
```

Example:

```ts
const bundle = await createBundle(tickets, {
  datasetId: 'tickets-2025-11-22',
  facets: ['customer', 'priority', 'status'],
  ranges: ['createdAt'],
  // Types are inferred from the data automatically
});
```

**Auto-meta behavior:**

By default, any remaining primitive fields that are not configured as id, facet, or range are automatically added to the manifest as meta fields. This makes the full record shape visible to agents and tooling while keeping the index focused.

- **Simple fields** (primitives and arrays of primitives) are auto-added as meta
- **Complex fields** (objects, nested structures) are silently skipped
- Set `autoMeta: false` to disable this behavior for wide or messy schemas

```ts
// Disable auto-meta for wide tables
const bundle = await createBundle(wideTable, {
  datasetId: 'wide',
  facets: ['status'],
  autoMeta: false, // Only explicitly configured fields will appear
});
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
- `SimpleBundleConfig<TItem>` - Simple, ergonomic bundle configuration with type inference
- `AnyBundleConfig<TItem>` - Union type representing either explicit or simple config

### Schema Helpers

#### `buildQuerySchema(manifest, options?)`

Builds a JSON schema that describes the structure of a `LyraQuery` for a given manifest. The generated schema matches the `LyraQuery` contract exactly, ensuring type compatibility.

The schema is driven by `manifest.capabilities.facets` and `manifest.capabilities.ranges` as the source of truth for queryable fields. Only fields listed in these capability arrays will appear in the generated schema, ensuring fidelity with what Lyra actually supports for queries.

```ts
declare function buildQuerySchema(
  manifest: LyraManifest,
  options?: QuerySchemaOptions
): JsonSchema;

interface QuerySchemaOptions {
  /**
   * How to represent facet values in the schema.
   * - 'single': Facet values must be a single primitive
   * - 'single-or-array': Facet values can be either a single primitive or an array (default)
   */
  facetArrayMode?: 'single' | 'single-or-array';
}
```

The generated schema includes:
- `facets`: Object with facet field names as keys (from `capabilities.facets`, with type-specific schemas)
- `ranges`: Object with range field names as keys (from `capabilities.ranges`, with min/max number properties)
- `limit`, `offset`: Optional number fields
- `includeFacetCounts`: Optional boolean field

Example:

```ts
const manifest = bundle.describe();
const schema = buildQuerySchema(manifest);

// Use schema for validation, documentation, or tool generation
```

When `facetArrayMode` is `'single-or-array'` (default), facet fields use `anyOf` to allow both single values and arrays:

```json
{
  "anyOf": [
    { "type": "string" },
    { "type": "array", "items": { "type": "string" } }
  ]
}
```

When `facetArrayMode` is `'single'`, facet fields are restricted to single primitives:

```json
{
  "type": "string"
}
```

#### `buildOpenAiTool(manifest, options)`

Builds an OpenAI tool definition from a Lyra manifest. The tool schema is automatically derived from the manifest, ensuring it matches the `LyraQuery` contract exactly.

```ts
declare function buildOpenAiTool(
  manifest: LyraManifest,
  options: OpenAiToolOptions
): {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
};

interface OpenAiToolOptions {
  name: string;
  description?: string;
}
```

Example:

```ts
const manifest = bundle.describe();
const tool = buildOpenAiTool(manifest, {
  name: 'lyraQuery',
  description: 'Query work items using facet and range filters',
});

// Pass tool to OpenAI API
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  tools: [tool],
  // ...
});
```

If `description` is omitted, a default description is generated using the dataset ID from the manifest.

## Error Behavior

### `createBundle` / `LyraBundle.create`

**Throws** synchronously/asynchronously with `Error` in these cases:

- **Invalid field config:**
  - `kind` not in `['id','facet','range','meta']`
  - `type` not in `['string','number','boolean','date']`
  - Error message: `Invalid field kind "foo" for field "status". Must be one of: id, facet, range, meta.`

- **Invalid range type inference** (simple config only):
  - Range field contains non-numeric, non-date string values
  - Error message: `Cannot infer range type for field "createdAt". Encountered non-numeric, non-date string value: "invalid".`

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

### Status

**Lyra v1.0.0 is stable and production-ready.** This release marks the first stable version of the library with a complete feature set for building and querying faceted index bundles.

**Completed:**

- ✅ Manifest and query model solidified
- ✅ Basic facet counts in `LyraResult` (via `includeFacetCounts`)
- ✅ First-class agent integration helpers (`buildQuerySchema`, `buildOpenAiTool`)

**Future directions:**

- Optional binary format for faster load times and smaller bundles
- Segment support for very large datasets
- CLI for building, inspecting, and validating bundles
- Additional schema inspection and diagnostics utilities
- Further optimizations for in-memory index structures
