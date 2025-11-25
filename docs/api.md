# API Reference

Complete API reference for Lyra, including all type definitions and function signatures.

## Core Functions

### `createBundle<T>(items, config)`

Builds a bundle from an array of items. Supports both explicit and simple configuration styles.

**Signatures:**

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

**Parameters:**

- `items`: Array of data items to index
- `config`: Bundle configuration (either `CreateBundleConfig` or `SimpleBundleConfig`)

**Returns:**

Promise resolving to a `LyraBundle<T>` instance.

**Example:**

```ts
const bundle = await createBundle(tickets, {
  datasetId: 'tickets-2025-11-22',
  facets: ['customer', 'priority', 'status'],
  ranges: ['createdAt'],
});
```

## Core Classes

### `class LyraBundle<T>`

Core runtime object for querying bundles.

#### Methods

##### `query(q: LyraQuery): LyraResult<T>`

Execute a query against the bundle.

**Parameters:**

- `q`: Query object with facet filters, range filters, pagination, and optional facet counts

**Returns:**

`LyraResult<T>` containing matching items, total count, applied query, optional facet counts, and snapshot metadata.

**Example:**

```ts
const result = bundle.query({
  facets: { status: 'open', priority: 'high' },
  ranges: { createdAt: { min: oneWeekAgo, max: now } },
  limit: 50,
  includeFacetCounts: true,
});
```

##### `getFacetSummary(field, options?): { field: string; values: Array<{ value: string | number | boolean; count: number }> }`

Get facet summary for a single field (dashboard-friendly).

**Parameters:**

- `field`: The facet field name to summarize
- `options`: Optional filters to apply before counting:
  - `facets?: LyraQuery['facets']` - Facet filters
  - `ranges?: LyraQuery['ranges']` - Range filters

**Returns:**

Summary object with field name and array of value/count pairs, sorted by value.

**Example:**

```ts
// Get all distinct status values and counts
const summary = bundle.getFacetSummary('status');

// Get status values under current filters
const filteredSummary = bundle.getFacetSummary('status', {
  facets: { customerId: 'C-ACME' },
});
```

**Notes:**

- Only facet fields are supported (`capabilities.facets`)
- Counts respect any filters you pass
- `null`/`undefined` values are excluded from counts
- Arrays contribute one count per element (including duplicates)
- Values are returned in sorted order (numbers ascending, booleans false-then-true, strings lexicographic)

##### `describe(): LyraManifest`

Get the bundle manifest describing fields and capabilities.

**Returns:**

`LyraManifest` object.

##### `snapshot(): LyraSnapshotInfo`

Get snapshot metadata.

**Returns:**

`LyraSnapshotInfo` object with `datasetId`, `builtAt`, and `indexVersion`.

##### `toJSON(): LyraBundleJSON<T>`

Serialize the bundle to a plain JSON-compatible structure.

**Returns:**

Plain object suitable for JSON serialization. Does not include any methods or prototype data.

##### `static load<TItem>(raw: LyraBundleJSON<TItem>): LyraBundle<TItem>`

Load a bundle from serialized JSON.

**Parameters:**

- `raw`: Serialized bundle JSON (string or plain object)

**Returns:**

`LyraBundle<TItem>` instance.

**Example:**

```ts
const stored = await fetch('/data/tickets-bundle.json').then((r) => r.json());
const bundle = LyraBundle.load<Ticket>(stored);
```

## Type Definitions

### `CreateBundleConfig<TItem>`

Explicit bundle configuration for a given item type. The generic parameter ensures compile-time field name validation.

```ts
interface CreateBundleConfig<TItem extends Record<string, unknown>> {
  datasetId: string;
  fields: {
    [K in Extract<keyof TItem, string>]?: FieldDefinition;
  };
}
```

**Properties:**

- `datasetId`: Logical identifier for the dataset
- `fields`: Object mapping field names to field definitions. Keys must be string keys of `TItem`. Fields that do not exist in any item will emit a warning but not throw.

**Example:**

```ts
type Ticket = { id: string; status: string; priority: string };

const config: CreateBundleConfig<Ticket> = {
  datasetId: 'tickets',
  fields: {
    id: { kind: 'id', type: 'string' },
    status: { kind: 'facet', type: 'string' },
    priority: { kind: 'facet', type: 'string' },
  },
};
```

### `SimpleBundleConfig<TItem>`

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

**Properties:**

- `datasetId`: Logical identifier for the dataset
- `id`: Optional explicit ID field name. If omitted, will auto-detect from common patterns ('id', 'Id', 'ID')
- `facets`: Array of field names to index as facets (for equality filtering)
- `ranges`: Array of field names to index as ranges (for numeric/date range filtering). Must be numeric or date values.
- `meta`: Array of field names to include in manifest as meta (non-indexed, schema-visible)
- `inferTypes`: How aggressively to infer field types:
  - `'runtime'`: Inspect actual values in the data (default)
  - `'none'`: Default all fields to 'string' type
- `autoMeta`: Whether to automatically add remaining simple fields as meta. Defaults to `true`. When enabled, any primitive fields not explicitly configured as id/facet/range/meta will be added to the manifest as meta fields. Complex/nested fields are always skipped.

**Example:**

```ts
const bundle = await createBundle(tickets, {
  datasetId: 'tickets-2025-11-22',
  id: 'id', // optional; will auto-detect 'id'/'Id'/'ID' if omitted
  facets: ['customer', 'priority', 'status'],
  ranges: ['createdAt'],
  autoMeta: true, // default: auto-add remaining simple fields as meta
});
```

### `LyraQuery`

Query parameters for executing facet and range filters against a bundle.

```ts
interface LyraQuery {
  facets?: Record<string, FacetValue>;
  ranges?: Record<string, RangeFilter>;
  limit?: number;
  offset?: number;
  includeFacetCounts?: boolean;
}
```

**Properties:**

- `facets`: Object mapping facet field names to values. Values can be single primitives or arrays (array fields match if any element matches).
- `ranges`: Object mapping range field names to range filters with `min` and/or `max` bounds.
- `limit`: Maximum number of results to return.
- `offset`: Number of results to skip (for pagination).
- `includeFacetCounts`: If `true`, include facet counts in the response for all facet fields.

### `LyraResult<Item>`

Structured result of executing a query against a bundle.

```ts
interface LyraResult<Item = unknown> {
  items: Item[];
  total: number;
  applied: {
    facets?: LyraQuery['facets'];
    ranges?: LyraQuery['ranges'];
  };
  facets?: FacetCounts;
  snapshot: LyraSnapshotInfo;
}
```

**Properties:**

- `items`: Array of matching items (paginated according to `limit` and `offset`).
- `total`: Total number of matching items (before pagination).
- `applied`: The query that was applied (normalized).
- `facets`: Optional facet counts for drilldown UI (only present if `includeFacetCounts: true`).
- `snapshot`: Snapshot metadata (datasetId, builtAt, indexVersion).

### `LyraManifest`

Manifest describing an entire bundle and its capabilities.

```ts
interface LyraManifest {
  version: string;
  datasetId: string;
  builtAt: string;
  fields: LyraField[];
  capabilities: {
    facets: string[];
    ranges: string[];
  };
}
```

**Properties:**

- `version`: Bundle format version (e.g., "1.0.0").
- `datasetId`: Logical identifier for the dataset.
- `builtAt`: ISO 8601 timestamp indicating when the bundle was created.
- `fields`: Array of field definitions describing each field.
- `capabilities`: Object describing which fields support which query types. **The `capabilities` object is the authoritative source of truth for queryable fields.** Only fields listed in `capabilities.facets` can be used in facet filters, and only fields listed in `capabilities.ranges` can be used in range filters.

### `LyraSnapshotInfo`

Immutable snapshot metadata for a bundle at query time.

```ts
interface LyraSnapshotInfo {
  datasetId: string;
  builtAt: string;
  indexVersion: string;
}
```

### `LyraBundleJSON<T>`

Serialized bundle format (v1).

```ts
type LyraBundleJSON<T = unknown> = {
  manifest: LyraManifest;
  items: T[];
  facetIndex: FacetPostingLists;
};
```

### `FieldDefinition`

Definition of a single field when creating a bundle.

```ts
interface FieldDefinition {
  kind: FieldKind;
  type: FieldType;
}
```

### `FieldKind`

Field kind determines how a field is used.

```ts
type FieldKind = 'id' | 'facet' | 'range' | 'meta';
```

- `'id'`: Identifier field; currently informational for the manifest. It is stored in the items like any other field and is not specially indexed in v1.
- `'facet'`: Indexed for equality and IN filters. Values are stored in a posting list index for fast intersection.
- `'range'`: Considered in numeric/date range filters. Values are checked at query time against min/max bounds.
- `'meta'`: Included in the manifest for schema awareness, but not indexed. Useful for agent/tool descriptions and documentation.

### `FieldType`

Field type determines how values are interpreted.

```ts
type FieldType = 'string' | 'number' | 'boolean' | 'date';
```

- `'string'`: String values
- `'number'`: Numeric values
- `'boolean'`: Boolean values
- `'date'`: Date values. If stored as numbers, they are interpreted as Unix timestamps in milliseconds. If stored as strings, they are parsed with `Date.parse()` and compared as timestamps. Items whose values cannot be parsed are effectively excluded from range results.

### `FacetValue`

A facet value can be a single primitive or an array of primitives.

```ts
type FacetPrimitive = string | number | boolean;
type FacetValue = FacetPrimitive | FacetPrimitive[];
```

Array values are treated as "matches if any value matches" in queries.

### `RangeFilter`

Range filter for numeric or date fields.

```ts
type RangeFilter = {
  min?: number;
  max?: number;
};
```

**Range semantics:**

- `min` and `max` must be numbers
- For date fields, pass epoch milliseconds (e.g., `Date.parse(isoString)`)
- Items are included if their value is >= `min` (if provided) and <= `max` (if provided)

### `FacetCounts`

Aggregated facet counts for a result set.

```ts
interface FacetCounts {
  [field: string]: Record<string, number>;
}
```

Maps facet field names to objects mapping value strings to counts.

### `AnyBundleConfig<TItem>`

Union type representing either explicit or simple bundle configuration. Used internally by `createBundle` to support both configuration styles.

```ts
type AnyBundleConfig<TItem extends Record<string, unknown>> =
  | CreateBundleConfig<TItem>
  | SimpleBundleConfig<TItem>;
```

### `FieldName<T>`

Helper type for extracting string field names from a type.

```ts
type FieldName<T> = Extract<keyof T, string>;
```

## Internal Types

The following types are used internally and are not part of the public API, but may be referenced in type definitions:

- `LyraField`: Internal field representation with `ops` array
- `FacetPostingLists`: Internal facet index structure

