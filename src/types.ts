/**
 * Primitive values that can be used in facet filters.
 */
export type FacetPrimitive = string | number | boolean;

/**
 * A facet value can be a single primitive or an array of primitives.
 */
export type FacetValue = FacetPrimitive | FacetPrimitive[];

/**
 * Range filter for numeric or date fields.
 * 
 * Range semantics:
 * - `min` and `max` must be numbers
 * - For date fields, pass epoch milliseconds (e.g., `Date.parse(isoString)`)
 * - Items are included if their value is >= `min` (if provided) and <= `max` (if provided)
 */
export type RangeFilter = {
  min?: number;
  max?: number;
};

/**
 * Mode for combining multiple facet filter objects.
 * - 'union': Items matching ANY of the facet objects (OR logic)
 * - 'intersection': Items matching ALL of the facet objects (AND logic)
 */
export type FacetMode = 'union' | 'intersection';

/**
 * Mode for combining multiple range filter objects.
 * - 'union': Items matching ANY of the range objects (OR logic)
 * - 'intersection': Items matching ALL of the range objects (AND logic)
 */
export type RangeMode = 'union' | 'intersection';

/**
 * Query parameters for executing facet and range filters against a bundle.
 * 
 * Facets and ranges can be provided as:
 * - A single object (traditional format)
 * - An array of objects (for multi-condition queries)
 * 
 * When using arrays, the `facetMode` and `rangeMode` parameters control
 * how the conditions are combined (union/OR by default).
 */
export interface LyraQuery {
  facets?: Record<string, FacetValue> | Array<Record<string, FacetValue>>;
  ranges?: Record<string, RangeFilter> | Array<Record<string, RangeFilter>>;
  facetMode?: FacetMode;
  rangeMode?: RangeMode;
  limit?: number;
  offset?: number;
  includeFacetCounts?: boolean;
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

export type FieldKind = 'id' | 'facet' | 'range' | 'meta';

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
    facets: string[];
    ranges: string[];
  };
}

/**
 * Structured result of executing a query against a bundle.
 */
export interface LyraResult<Item = unknown> {
  items: Item[];
  total: number;
  applied: {
    facets?: LyraQuery['facets'];
    ranges?: LyraQuery['ranges'];
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
   */
  facets?: FieldName<TItem>[];
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
 * Internal type for facet posting lists (not exported, but needed for bundle JSON).
 * @internal
 */
export type FacetPostingLists = {
  [field: string]: {
    [valueKey: string]: number[]; // item indices
  };
};

/**
 * Serialized bundle format (v1).
 */
export type LyraBundleJSON<T = unknown> = {
  manifest: LyraManifest;
  items: T[];
  facetIndex: FacetPostingLists;
};