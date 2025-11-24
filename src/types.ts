// Types
// ==============================

export type FacetFilter = Record<string, unknown | unknown[]>;

export type RangeFilter = Record<string, { min?: number; max?: number }>;

/**
 * Query parameters for executing facet and range filters against a bundle.
 */
export interface LyraQuery {
  facets?: FacetFilter;
  ranges?: RangeFilter;
  limit?: number;
  offset?: number;
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
    facets?: FacetFilter;
    ranges?: RangeFilter;
  };
  facets?: FacetCounts;
  snapshot: LyraSnapshotInfo;
}

/**
 * Configuration for a single field when creating a bundle.
 */
export interface FieldConfig {
  kind: FieldKind;
  type: FieldType;
}

/**
 * Configuration required to create a new bundle.
 */
export interface CreateBundleConfig {
  datasetId: string;
  fields: Record<string, FieldConfig>;
}