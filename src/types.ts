// Types
// ==============================

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
 * Query parameters for executing facet and range filters against a bundle.
 */
export interface LyraQuery {
  facets?: Record<string, FacetValue>;
  ranges?: Record<string, RangeFilter>;
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