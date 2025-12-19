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
// Single object format (traditional)
const result = bundle.query({
  facets: { status: 'open', priority: 'high' },
  ranges: { createdAt: { min: oneWeekAgo, max: now } },
  limit: 50,
  includeFacetCounts: true,
});

// Array format with union (OR logic)
const result = bundle.query({
  facets: [
    { status: 'open', priority: 'high' },
    { status: 'in_progress', priority: 'urgent' }
  ],
  limit: 50,
  includeFacetCounts: true,
});
```

##### `getFacetSummary(field, options?): { field: string; values: Array<{ value: string | number | boolean; count: number }> }`

Get facet summary for a single field (dashboard-friendly).

**Parameters:**

- `field`: The facet field name to summarize
- `options`: Optional filters to apply before counting (v2 syntax):
  - `equal?: Record<string, Scalar | Scalar[]>` - Equality filters
  - `ranges?: Record<string, RangeBound>` - Range filters

**Returns:**

Summary object with field name and array of value/count pairs, sorted by value.

**Example:**

```ts
// Get all distinct status values and counts
const summary = bundle.getFacetSummary('status');

// Get status values under current filters
const filteredSummary = bundle.getFacetSummary('status', {
  equal: { customerId: 'C-ACME' },
});
```

**Notes:**

- Only facet fields are supported (`capabilities.facets`)
- Counts respect any filters you pass
- `null`/`undefined` values are excluded from counts
- Arrays contribute one count per element (including duplicates)
- Values are returned in sorted order (numbers ascending, booleans false-then-true, strings lexicographic)

##### Alias Utility Methods (v2)

Methods for working with alias fields and enriching results with human-readable values.

##### `getAliasValues(aliasField: string, canonicalId: string | number): string[]`

Get alias values for a single canonical ID.

**Parameters:**

- `aliasField`: The alias field name
- `canonicalId`: The canonical ID to look up

**Returns:**

Array of alias values for the given ID (empty array if not found).

**Example:**

```ts
const aliases = bundle.getAliasValues('zone_name', 'Z-001');
// ['Zone A']
```

##### `getAliasMap(aliasField: string, canonicalIds: (string | number)[]): Map<string | number, string[]>`

Batch lookup alias values for multiple canonical IDs. Efficiently deduplicates IDs before lookup.

**Parameters:**

- `aliasField`: The alias field name
- `canonicalIds`: Array of canonical IDs to look up

**Returns:**

Map from canonical ID to array of alias values.

**Example:**

```ts
const aliasMap = bundle.getAliasMap('zone_name', ['Z-001', 'Z-002', 'Z-001']);
// Map { 'Z-001' => ['Zone A'], 'Z-002' => ['Zone B'] }
```

##### `getAllAliases(aliasField: string): Map<string, string[]> | undefined`

Get the complete ID-to-aliases mapping for an alias field.

**Parameters:**

- `aliasField`: The alias field name

**Returns:**

Map from canonical ID to array of alias values, or `undefined` if the alias field doesn't exist.

**Example:**

```ts
const allAliases = bundle.getAllAliases('zone_name');
// Map { 'Z-001' => ['Zone A'], 'Z-002' => ['Zone B'], ... }
```

##### `getMultiAliasMap(aliasFields: string[], canonicalIds: (string | number)[]): Map<string, Map<string | number, string[]>>`

Get alias maps for multiple alias fields in a single call.

**Parameters:**

- `aliasFields`: Array of alias field names
- `canonicalIds`: Array of canonical IDs to look up

**Returns:**

Map from alias field name to Map of canonical ID to alias values.

**Example:**

```ts
const multiMap = bundle.getMultiAliasMap(['zone_name', 'zone_label'], ['Z-001', 'Z-002']);
// Map {
//   'zone_name' => Map { 'Z-001' => ['Zone A'], 'Z-002' => ['Zone B'] },
//   'zone_label' => Map { 'Z-001' => ['First Floor'], 'Z-002' => ['Second Floor'] }
// }
```

##### `enrichResult(result: LyraResult<T>, aliasFields: string[]): LyraResult<T & Record<string, string[]>>`

Enrich a query result with alias values. Returns a new result object with enriched items.

**Parameters:**

- `result`: The query result to enrich
- `aliasFields`: Array of alias field names to enrich

**Returns:**

New `LyraResult` with items enriched with alias fields.

**Example:**

```ts
const result = bundle.query({ equal: { zone_id: 'Z-001' } });
const enriched = bundle.enrichResult(result, ['zone_name', 'zone_label']);
// enriched.items[0].zone_name = ['Zone A']
```

##### `enrichItems(items: T[], aliasFields: string[]): Array<T & Record<string, string[]>>`

Enrich an array of items with alias values using efficient batch lookup. Automatically deduplicates IDs for optimal performance.

**Parameters:**

- `items`: Array of items to enrich
- `aliasFields`: Array of alias field names to enrich

**Returns:**

Array of enriched items with alias fields added.

**Example:**

```ts
const result = bundle.query({ equal: { zone_id: 'Z-001' } });
const enriched = bundle.enrichItems(result.items, ['zone_name', 'zone_label']);
// enriched[0].zone_name = ['Zone A']
// enriched[0].zone_label = ['First Floor']
```

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
  /** Fields to index as facets (for equality filtering). Prefer `equal` for v2. */
  facets?: FieldName<TItem>[];
  /** Fields to index as facets (v2, preferred over `facets`). */
  equal?: FieldName<TItem>[];
  /** Fields to index as ranges (for numeric/date range filtering). */
  ranges?: FieldName<TItem>[];
  /** Fields to include in manifest as meta (non-indexed, schema-visible). */
  meta?: FieldName<TItem>[];
  /** Alias fields mapping alias name to canonical field (v2). */
  aliases?: Record<string, FieldName<TItem>>;
  /** How aggressively to infer field types. Default: 'runtime'. */
  inferTypes?: 'none' | 'runtime';
  /** Whether to auto-add remaining simple fields as meta. Default: true. */
  autoMeta?: boolean;
}
```

**Properties:**

- `datasetId`: Logical identifier for the dataset
- `id`: Optional explicit ID field name. If omitted, will auto-detect from common patterns ('id', 'Id', 'ID')
- `facets`: Array of field names to index as facets (for equality filtering). Kept for backward compatibility; prefer `equal` for v2.
- `equal`: Array of field names to index as facets (v2, preferred over `facets`)
- `ranges`: Array of field names to index as ranges (for numeric/date range filtering). Must be numeric or date values.
- `meta`: Array of field names to include in manifest as meta (non-indexed, schema-visible)
- `aliases`: Object mapping alias field names to canonical field names (v2). Lookup tables are auto-generated from item data.
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

Query parameters for executing filters against a bundle (v2).

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
  enrichAliases?: boolean | string[];              // Enrich results with alias values (defaults to false, opt-in)
}
```

**Properties:**

- `equal`: Equality filters. Single scalar value = exact match, array = IN semantics.
- `notEqual`: Inequality filters. Single scalar value = `!= x`, array = NOT IN semantics.
- `ranges`: Range filters for numeric/date fields. `RangeBound` has `min` and/or `max` (inclusive).
- `isNull`: Array of field names that must be NULL.
- `isNotNull`: Array of field names that must NOT be NULL.
- `limit`: Maximum number of results to return.
- `offset`: Number of results to skip (for pagination).
- `includeFacetCounts`: If `true`, include facet counts in the response for all facet fields.
- `enrichAliases`: Enrich results with alias values. `true` = all aliases, `string[]` = specific alias fields. Defaults to `false` (opt-in).

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

// Null checks
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

### `LyraResult<Item>`

Structured result of executing a query against a bundle (v2).

```ts
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
  facets?: FacetCounts;
  snapshot: LyraSnapshotInfo;
  enrichedAliases?: Array<Record<string, string[]>>; // Parallel array (backward compatibility; items enriched directly when enrichAliases: true)
}
```

**Properties:**

- `items`: Array of matching items (paginated according to `limit` and `offset`). When `enrichAliases: true`, items are enriched directly with alias fields.
- `total`: Total number of matching items (before pagination).
- `applied`: The query that was applied (normalized).
- `facets`: Optional facet counts for drilldown UI (only present if `includeFacetCounts: true`).
- `enrichedAliases`: Optional parallel array of alias values (backward compatibility). When `enrichAliases: true`, items are enriched directly, and this array is also populated.
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

### `FacetMode`

Mode for combining multiple facet filter objects.

```ts
type FacetMode = 'union' | 'intersection';
```

- `'union'`: Items matching ANY of the facet objects (OR logic) - default
- `'intersection'`: Items matching ALL of the facet objects (AND logic)

### `RangeMode`

Mode for combining multiple range filter objects.

```ts
type RangeMode = 'union' | 'intersection';
```

- `'union'`: Items matching ANY of the range objects (OR logic) - default
- `'intersection'`: Items matching ALL of the range objects (AND logic)

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

