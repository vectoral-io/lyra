/**
 * Scalar values that can be used in query filters.
 * Includes null for explicit null checks.
 */
export type Scalar = string | number | boolean | null;

/**
 * Range bound for numeric or date fields.
 * 
 * Range semantics:
 * - `min` and `max` must be numbers
 * - For date fields, pass epoch milliseconds (e.g., `Date.parse(isoString)`)
 * - Items are included if their value is >= `min` (if provided) and <= `max` (if provided)
 */
export interface RangeBound {
  min?: number;
  max?: number;
}

/**
 * Query parameters for executing filters against a Lyra bundle.
 *
 * **Null Handling:**
 * - `equal: { field: null }` is normalized to `isNull: ['field']` during query processing
 * - `notEqual: { field: null }` is normalized to `isNotNull: ['field']`
 * - Arrays containing null (e.g., `equal: { field: ['A', null] }`) are split into value filters + null checks
 * 
 * **All filter operators are intersected (AND logic).**
 * 
 * @example
 * ```ts
 * // Simple equality
 * bundle.query({ equal: { status: 'open' } });
 * 
 * // IN semantics with array
 * bundle.query({ equal: { priority: ['high', 'urgent'] } });
 * 
 * // Null checks (inline or explicit)
 * bundle.query({ equal: { category: null } }); // Normalized to isNull
 * bundle.query({ isNull: ['category'] }); // Explicit
 * 
 * // Exclusion filters
 * bundle.query({ notEqual: { status: 'closed' } });
 * 
 * // Mixed operators
 * bundle.query({
 *   equal: { zone_name: 'Zone A' }, // Alias field
 *   isNotNull: ['wip_trade'],
 *   ranges: { createdAt: { min: Date.parse('2025-01-01') } },
 * });
 * ```
 */
export interface LyraQuery {
  /**
   * Equality filters.
   * - Single scalar (non-null) => exact match
   * - Array => IN semantics
   * - null values are normalized to `isNull` during query processing
   *
   * Works with both canonical fields and alias fields.
   */
  equal?: Record<string, Scalar | Scalar[]>;

  /**
   * Inequality filters.
   * - Single scalar (non-null) => value != x (and NOT NULL)
   * - Array => value NOT IN [...]
   * - null values are normalized to `isNotNull` during query processing
   */
  notEqual?: Record<string, Scalar | Scalar[]>;

  /**
   * Range filters for numeric or date fields.
   */
  ranges?: Record<string, RangeBound>;

  /**
   * Fields that must be NULL.
   * Implemented as `field IS NULL` filter.
   */
  isNull?: string[];

  /**
   * Fields that must NOT be NULL.
   * Implemented as `field IS NOT NULL` filter.
   */
  isNotNull?: string[];

  /**
   * Maximum number of items to return.
   */
  limit?: number;

  /**
   * Number of items to skip (for pagination).
   */
  offset?: number;

  /**
   * Restrict materialized result items to these fields (projection).
   *
   * When set, each returned item contains only the listed fields that are
   * present on the row (missing / `undefined` values are omitted). This trims
   * per-result allocation and, on columnar (binary-loaded) bundles, avoids
   * decoding columns you never select. Filtering, `total`, and facet counts are
   * unaffected — projection only shapes the returned `items`.
   *
   * Note: fields consumed by `enrichAliases` (the canonical ID fields) must be
   * included here, otherwise enrichment has nothing to resolve against.
   */
  select?: string[];

  /**
   * Whether to include facet counts in the result.
   * Facet counts are computed over the filtered result set.
   */
  includeFacetCounts?: boolean;

  /**
   * Enrich result items with human-readable alias values.
   *
   * Opt-in for performance — defaults to `false` even when the bundle declares aliases.
   * - `true`: add all declared alias fields to each item.
   * - `string[]`: add only the listed alias fields.
   * - `false` / omitted: return items unchanged.
   *
   * When enabled, each item gains a `string[]` property per alias field (e.g.
   * `item.zone_name = ['Zone A']`). Items without a canonical ID for a given alias
   * are left untouched for that field.
   */
  enrichAliases?: boolean | string[];
}

/**
 * Aggregated facet counts for a result set.
 */
export interface FacetCounts {
  [field: string]: Record<string, number>;
}

/**
 * Immutable snapshot metadata for a bundle at query time.
 */
export interface LyraSnapshotInfo {
  datasetId: string;
  builtAt: string;
  indexVersion: string;
}

export type FieldKind = 'id' | 'facet' | 'range' | 'meta' | 'alias';

export type FieldType = 'string' | 'number' | 'boolean' | 'date';

/**
 * Definition of a single field within a bundle.
 * @internal
 */
export interface LyraField {
  name: string;
  kind: FieldKind;
  type: FieldType;
  ops: Array<'eq' | 'in' | 'between' | 'gte' | 'lte'>;
  
  /**
   * For alias fields (kind='alias'): the canonical facet field this alias resolves to.
   * Example: If `zone_name` is an alias for `zone_id`, then `aliasTarget = 'zone_id'`.
   */
  aliasTarget?: string;
}

/**
 * Lookup table for alias resolution.
 * Auto-generated during bundle creation from item data.
 * @internal
 */
export interface LookupTable {
  /**
   * Maps alias values to canonical IDs.
   * Example: { "Zone A": ["Z-001", "Z-007"], "Zone B": ["Z-002"] }
   */
  aliasToIds: Record<string, string[]>;

  /**
   * Reverse lookup: maps canonical IDs to alias values.
   * Used for result enrichment.
   * Example: { "Z-001": ["Zone A"], "Z-007": ["Zone A"], "Z-002": ["Zone B"] }
   */
  idToAliases: Record<string, string[]>;
}

/**
 * Manifest describing an entire bundle and its capabilities.
 */
export interface LyraManifest {
  version: string;
  datasetId: string;
  builtAt: string;
  fields: LyraField[];
  capabilities: {
    /** Canonical facet field names (indexed for filtering) */
    facets: string[];
    /** Range field names (indexed for numeric/date filtering) */
    ranges: string[];
    /** Alias field names (resolve to canonical facets via lookups) */
    aliases?: string[];
  };
  /**
   * Lookup tables for alias resolution, keyed by alias field name.
   * Auto-generated during bundle creation. Not configurable by users.
   * @internal
   */
  lookups?: Record<string, LookupTable>;
}

/**
 * Structured result of executing a query against a bundle.
 */
export interface LyraResult<Item = unknown> {
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
}

/**
 * Definition of a single field when creating a bundle.
 */
export interface FieldDefinition {
  kind: FieldKind;
  type: FieldType;
  /**
   * For alias fields: the canonical field this alias resolves to.
   * Example: If `zone_name` is an alias for `zone_id`, then `targetField = 'zone_id'`.
   */
  targetField?: string;
}

type StringKeys<T> = Extract<keyof T, string>;

/**
 * Bundle configuration for a given item type.
 *
 * TItem is your row shape, e.g. Ticket, User, etc.
 */
export interface CreateBundleConfig<TItem extends Record<string, unknown>> {
  datasetId: string;
  /**
   * Fields to be indexed or tracked in the manifest.
   *
   * Keys must be string keys of TItem; the config is optional-per-field.
   * At runtime, fields that do not exist in any item will only emit a warning.
   */
  fields: {
    [K in StringKeys<TItem>]?: FieldDefinition;
  };
}

/**
 * Helper type for extracting string field names from a type.
 */
export type FieldName<T> = Extract<keyof T, string>;

/**
 * Simple, ergonomic bundle configuration that infers types automatically.
 *
 * This config style allows you to specify fields by purpose (id, facets, ranges, meta)
 * rather than requiring full field definitions. Types are inferred from the data at runtime.
 *
 * @example
 * ```ts
 * const bundle = await createBundle(tickets, {
 *   datasetId: 'tickets-2025-11-22',
 *   id: 'id', // optional; will auto-detect 'id'/'Id'/'ID' if omitted
 *   facets: ['customer', 'priority', 'status'],
 *   ranges: ['createdAt'],
 *   autoMeta: true, // default: auto-add remaining simple fields as meta
 * });
 * ```
 */
export interface SimpleBundleConfig<TItem extends Record<string, unknown>> {
  datasetId: string;
  /**
   * Explicit ID field name. If omitted, will auto-detect from common patterns:
   * 'id', 'Id', or 'ID'.
   */
  id?: FieldName<TItem>;
  /**
   * Fields to index as facets (for equality filtering).
   * @deprecated Use `equal` instead.
   */
  facets?: FieldName<TItem>[];
  /**
   * Fields to index as facets (for equality filtering).
   */
  equal?: FieldName<TItem>[];
  /**
   * Fields to index as ranges (for numeric/date range filtering).
   * Must be numeric or date values.
   */
  ranges?: FieldName<TItem>[];
  /**
   * Fields to include in manifest as meta (non-indexed, schema-visible).
   */
  meta?: FieldName<TItem>[];
  /**
   * Alias fields: aliasField → canonicalField.
   * Lookups are auto-generated from item data during bundle creation.
   * Multiple aliases can target the same canonical field.
   */
  aliases?: Record<string, FieldName<TItem>>;
  /**
   * How aggressively to infer field types.
   * - 'runtime': Inspect actual values in the data (default)
   * - 'none': Default all fields to 'string' type
   */
  inferTypes?: 'none' | 'runtime';
  /**
   * Whether to automatically add remaining simple fields as meta.
   * Defaults to `true`. When enabled, any primitive fields not explicitly
   * configured as id/facet/range/meta will be added to the manifest as meta fields.
   * Complex/nested fields are always skipped.
   */
  autoMeta?: boolean;
}

/**
 * Union type representing either explicit or simple bundle configuration.
 * Used internally by `createBundle` to support both configuration styles.
 */
export type AnyBundleConfig<TItem extends Record<string, unknown>> =
  | CreateBundleConfig<TItem>
  | SimpleBundleConfig<TItem>;

/**
 * Bundle JSON format for facet posting lists. Postings serialize as `number[]`.
 * @internal
 */
export type FacetPostingLists = {
  [field: string]: {
    [valueKey: string]: number[]; // item indices
  };
};

/**
 * In-memory facet posting lists. Backed by Uint32Array for cache locality and
 * GC-free intersections; converted to/from `FacetPostingLists` at the JSON edge.
 * @internal
 */
export type InMemoryFacetIndex = {
  [field: string]: {
    [valueKey: string]: Uint32Array;
  };
};

/**
 * Bundle JSON format for null posting lists. Postings serialize as `number[]`.
 * @internal
 */
export type NullPostingLists = Record<string, number[]>;

/**
 * In-memory null posting lists, keyed by field name; Uint32Array per field.
 * @internal
 */
export type InMemoryNullIndex = Record<string, Uint32Array>;

/**
 * In-memory columnar storage for range fields. One `Float64Array` per range
 * field, length = items.length, NaN for null/unparsable entries. Built from
 * items at bundle creation/load — never serialized.
 * @internal
 */
export type RangeColumns = Record<string, Float64Array>;

/**
 * Range columns serialized as base64-encoded little-endian Float64 bytes.
 * Optional v3.1 field. When present, hydration is O(1) per column instead of
 * rebuilding from items.
 * @internal
 */
export type RangeColumnsJSON = Record<string, { encoding: 'b64f64'; data: string }>;

/**
 * Compact, base64-encoded delta+varint posting lists. Optional v3.1 fields.
 * When present, loaders should prefer these over `facetIndex` / `nullIndex`.
 * Producers may emit both forms for backwards compatibility with v3.0 readers.
 * @internal
 */
export type FacetPostingListsBin = Record<string, Record<string, string>>;
export type NullPostingListsBin = Record<string, string>;

/**
 * Serialized bundle format (v3).
 *
 * v3.1 introduces optional `rangeColumns`, `facetIndexBin`, and `nullIndexBin`
 * fields that accelerate hydration. v3.0 readers ignore unknown fields and
 * continue to use the legacy `facetIndex` / `nullIndex`.
 */
export type LyraBundleJSON<T = unknown> = {
  manifest: LyraManifest;
  items: T[];
  facetIndex: FacetPostingLists;
  /** Null posting lists, keyed by field name. */
  nullIndex: NullPostingLists;
  /**
   * v3.1 (optional): pre-encoded range columns. Avoids a per-load rescan of
   * items + Date.parse storm.
   */
  rangeColumns?: RangeColumnsJSON;
  /**
   * v3.1 (optional): delta+varint base64 facet posting lists. Smaller wire size
   * and faster hydrate than `facetIndex`. When present, takes precedence.
   */
  facetIndexBin?: FacetPostingListsBin;
  /**
   * v3.1 (optional): delta+varint base64 null posting lists. When present,
   * takes precedence over `nullIndex`.
   */
  nullIndexBin?: NullPostingListsBin;
};