<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./.github/logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="./.github/logo-light.png">
    <img alt="Lyra" src="./.github/logo-light.png" height="70" style="max-width: 100%;">
  </picture>
</p>

<p align="center">
  A lightweight engine for building precomputed indexes from structured data.
</p>

---

With Lyra, you:

- Build a snapshot of your data offline or in CI.
- Ship that snapshot as JSON.
- Load it anywhere (browser, server, edge, mobile) and run **fast, deterministic queries**.
- Expose it to LLM agents as a **structured tool** for precise, attribute-based retrieval.

Lyra is not a vector database or data warehouse. It is a **portable, manifest-driven query layer** that sits between your raw data and both agents and dashboards.

## Why Lyra?

Most stacks split into two extremes:

- Heavy infra (warehouses, vector DBs, OLAP) for analytics and RAG.
- Ad hoc client-side filtering (`array.filter`, one-off search libs) baked into each UI.

Lyra fills the space in between:

- **Deterministic snapshots** – the same inputs always produce the same bundle and the same answers.
- **Structured retrieval** – exact facet and range queries, not approximate semantic matches.
- **Environment-agnostic** – runs in Node, browsers, serverless, and edge runtimes.
- **Agent-native** – bundles are self-describing and easy to expose as LLM tools.

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
  // ...
];

// Simple config style (ergonomic, with type inference)
const bundle = await createBundle(tickets, {
  datasetId: 'tickets-2025-11-22',
  id: 'id', // optional; will auto-detect 'id'/'Id'/'ID' if omitted
  facets: ['customer', 'priority', 'status', 'productArea'],
  ranges: ['createdAt'],
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
  equal: {
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
```

## When to use Lyra

Use Lyra when you:

- Have **structured or semi-structured records** (tickets, projects, events, sensors, etc.).
- Want **instant filters and drilldowns** without shipping raw tables to the client.
- Need **offline / edge / browser** retrieval without live warehouses or vector stores.
- Want to give **LLM agents** a deterministic, inspectable view of world state they can query as a tool.

Lyra is **not** a replacement for:

- Full-text search across arbitrary documents.
- Semantic similarity search over large unstructured corpora.
- Real-time, strongly consistent transactional databases.

It is meant to complement those systems as a fast, portable index layer.

## Features

- **Precomputed bundles**  

  Build once from structured data, then reuse the bundle everywhere.

- **Explicit query operators (v2)**  

  Fast equality filters (`equal`), inequality filters (`notEqual`), null checks (`isNull`, `isNotNull`), and range queries (`ranges`). All operators support single values or arrays (IN semantics).

- **Dimension-aware aliases (v2)**  

  Query using human-readable names (e.g., `zone_name: 'Zone A'`) that automatically resolve to canonical IDs. Lookup tables are auto-generated from your data.

- **Range queries**  

  Filter by numeric or date ranges (`amount`, `createdAt`, `timestamp`, …).

- **Manifest-driven**  

  Each bundle includes a manifest describing field types and query capabilities (`facets`, `ranges`, `aliases`), plus snapshot metadata (dataset ID, build time, format version).

- **Deterministic & testable**  

  Queries over a given bundle are exact and reproducible, which makes debugging and verification straightforward.

- **No runtime ML cost**  

  No embeddings or models at query time; just precomputed indexes and simple operations.

- **Practical performance profile**  

  Optimized for sub-millisecond facet queries over medium-sized datasets (tens to low hundreds of thousands of records) on a single runtime.

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

**Bundle format specification:** See [docs/bundle-json-spec.md](./docs/bundle-json-spec.md) for the complete format specification.

### Manifest

The manifest is a JSON description embedded in the bundle. It includes:

- `datasetId`: logical name or ID for the dataset.
- `builtAt`: snapshot timestamp.
- `fields`: list of fields, their types, and roles (facet/range/meta).
- `capabilities`: which fields can be faceted or ranged. **The `capabilities` object is the authoritative source of truth for queryable fields.** Only fields listed in `capabilities.facets` can be used in facet filters, and only fields listed in `capabilities.ranges` can be used in range filters.

#### Field kinds

Each field in the manifest has a `kind` that determines how it's used:

- **`id`**: Identifier field; currently informational for the manifest. It is stored in the items like any other field and is not specially indexed.
- **`facet`**: Indexed for equality and IN filters. Values are stored in a posting list index for fast intersection.
- **`range`**: Considered in numeric/date range filters. Values are checked at query time against min/max bounds.
- **`meta`**: Included in the manifest for schema awareness, but not indexed. Useful for agent/tool descriptions and documentation.
- **`alias`** (v2): Human-readable fields that resolve to canonical facet IDs. Lookup tables are auto-generated from item data.

### Query and result

Lyra v2 uses explicit query operators for clarity and flexibility:

```ts
interface LyraQuery {
  equal?: Record<string, Scalar | Scalar[]>;      // Equality filters (IN semantics with arrays)
  notEqual?: Record<string, Scalar | Scalar[]>;   // Inequality filters (NOT IN with arrays)
  ranges?: Record<string, RangeBound>;            // Range filters
  isNull?: string[];                              // Fields that must be NULL
  isNotNull?: string[];                           // Fields that must NOT be NULL
  limit?: number;
  offset?: number;
  includeFacetCounts?: boolean;
  enrichAliases?: boolean | string[];             // Enrich results with alias values (defaults to true if aliases available)
}

interface LyraResult<Item = unknown> {
  items: Item[];
  total: number;
  applied: {
    equal?: LyraQuery['equal'];
    notEqual?: LyraQuery['notEqual'];
    ranges?: LyraQuery['ranges'];
    isNull?: LyraQuery['isNull'];
    isNotNull?: LyraQuery['isNotNull'];
  };
  facets?: FacetCounts; // optional facet counts for drilldown
  snapshot: LyraSnapshotInfo;
  enrichedAliases?: Array<Record<string, string[]>>; // Parallel array of alias values
}
```

**Query Examples:**

```ts
// Simple equality
bundle.query({
  equal: { status: 'open', priority: 'high' }
});

// IN semantics with arrays
bundle.query({
  equal: { priority: ['high', 'urgent'] }
});

// Null checks (inline or explicit)
bundle.query({
  equal: { category: null }  // Normalized to isNull internally
});

bundle.query({
  isNull: ['category'],
  isNotNull: ['status']
});

// Exclusion filters
bundle.query({
  notEqual: { status: ['closed', 'cancelled'] }
});

// Mixed operators (all intersected - AND logic)
bundle.query({
  equal: { customer: 'ACME' },
  notEqual: { priority: 'low' },
  isNotNull: ['status'],
  ranges: { createdAt: { min: oneWeekAgo, max: now } }
});
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

For how malformed or unknown fields are handled, see [Error behavior](#error-behavior).

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
- Supports array queries for complex multi-condition filtering (union/intersection modes)
- Use `total` and `facets` in the result to help the agent refine or broaden queries
- The `snapshot` metadata helps the agent understand data recency and identity

See [`examples/agent-tool/`](./examples/agent-tool/) for a complete working example, and [docs/agents.md](./docs/agents.md) for complete agent integration guide.

## Dashboards & facet UIs

Lyra provides two patterns for building dashboard dropdowns and drilldown UIs:

### Pattern 1: Raw query with `includeFacetCounts`

Get facet counts for all fields at once:

```ts
const result = bundle.query({
  equal: {
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
  equal: { customerId: 'C-ACME', status: 'open' },
});
// Counts reflect only items matching the filters
```

**Important notes:**

- **Only facet fields are supported** (`capabilities.facets`). Date fields are ranges and cannot be summarized with `getFacetSummary`.
- **Counts respect any filters you pass** - they reflect the post-filtered candidate set, perfect for drilldown UIs.
- **`null`/`undefined` values are excluded** from counts (consistent with query behavior).
- **Arrays contribute one count per element** (including duplicates). For example, an item with `tags: ['a', 'a', 'b']` contributes `'a': 2` and `'b': 1` to the counts.
- Values are returned in sorted order (numbers ascending, booleans false-then-true, strings lexicographic).

## Breaking Changes in v2

**Lyra v2 introduces a breaking change to the query API:**

- **`facets` field removed**: Use `equal` instead
- **`facetMode`/`rangeMode` removed**: All operators are intersected (AND logic)
- **New operators**: `equal`, `notEqual`, `isNull`, `isNotNull`
- **Alias support**: Query using human-readable names that resolve to canonical IDs
- **Bundle version**: All v2 bundles use `manifest.version = "2.0.0"`

See [docs/migration-v2.md](./docs/migration-v2.md) for complete migration guide.

## Public API

Lyra's v2 API is intentionally small and stable.

### Core Functions

- **`createBundle<T>(items, config)`** - Builds a bundle from an array of items. Supports both explicit and simple configuration styles.

### Core Classes

- **`class LyraBundle<T>`** - Core runtime object for querying bundles.
  - `query(q: LyraQuery): LyraResult<T>` - Execute a query against the bundle
  - `getFacetSummary(field, options?)` - Get facet summary for a single field
  - `describe(): LyraManifest` - Get the bundle manifest
  - `snapshot(): LyraSnapshotInfo` - Get snapshot metadata
  - `toJSON(): LyraBundleJSON<T>` - Serialize to JSON
  - `static load<TItem>(raw): LyraBundle<TItem>` - Load a bundle from JSON

### Schema Helpers

- **`buildQuerySchema(manifest, options?)`** - Builds a JSON schema describing `LyraQuery` structure
- **`buildOpenAiTool(manifest, options)`** - Builds an OpenAI tool definition from a manifest

See [docs/api.md](./docs/api.md) for complete API reference and type definitions.

## Error behavior

Lyra follows a **fail-closed** principle: invalid inputs result in empty results rather than errors, ensuring deterministic behavior.

- **`createBundle`** throws for invalid field config (`kind`/`type`); warns for missing fields
- **`LyraBundle.load`** throws for invalid bundle structure (missing manifest/items, invalid version, invalid capabilities)
- **`LyraBundle.query`** normalizes bad inputs: unknown fields = no matches, negative offset/limit clamped

See [docs/errors-and-guarantees.md](./docs/errors-and-guarantees.md) for complete error behavior documentation.

## Status and roadmap

**Lyra v2.0.0 is stable and production-ready.**

**Completed:**

- ✅ V2 query model with explicit operators (`equal`, `notEqual`, `isNull`, `isNotNull`)
- ✅ Dimension-aware aliases with auto-generated lookup tables
- ✅ First-class null handling (no more JS post-filtering)
- ✅ Result enrichment with human-readable alias values
- ✅ Basic facet counts in `LyraResult` (via `includeFacetCounts`)
- ✅ First-class agent integration helpers (`buildQuerySchema`, `buildOpenAiTool`)

**Future directions:**

- Optional binary format for faster load times and smaller bundles
- Segment support for very large datasets
- CLI for building, inspecting, and validating bundles
- Additional schema inspection and diagnostics utilities
