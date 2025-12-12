import type {
  AnyBundleConfig,
  CreateBundleConfig,
  FacetCounts,
  FacetMode,
  FacetPostingLists,
  FacetValue,
  FieldType,
  LyraBundleJSON,
  LyraManifest,
  LyraQuery,
  LyraResult,
  LyraSnapshotInfo,
  RangeFilter,
  RangeMode,
  SimpleBundleConfig,
} from './types';
import * as arrayOperations from './utils/array-operations';
import { buildFacetIndex, buildManifest } from './utils/builders';
import { fromSimpleConfig } from './utils/type-inference';


/**
 * Create a bundle from items.
 *
 * Overloads:
 * - Explicit config: full control over field kinds/types via `CreateBundleConfig`.
 * - Simple config: ergonomic `SimpleBundleConfig` that infers types from data.
 *
 * Both return a `LyraBundle<T>` with the same runtime behavior.
 */

// Explicit config overload
export function createBundle<T extends Record<string, unknown>>(
  items: T[],
  config: CreateBundleConfig<T>,
): Promise<LyraBundle<T>>;

// Simple config overload
export function createBundle<T extends Record<string, unknown>>(
  items: T[],
  config: SimpleBundleConfig<T>,
): Promise<LyraBundle<T>>;

// Implementation
export async function createBundle<T extends Record<string, unknown>>(
  items: T[],
  config: AnyBundleConfig<T>,
): Promise<LyraBundle<T>> {
  const explicitConfig: CreateBundleConfig<T> =
    'fields' in config
      ? config
      : fromSimpleConfig(items, config as SimpleBundleConfig<T>);

  return LyraBundle.create(items, explicitConfig);
}

// Components
// ==============================

/**
 * Immutable bundle of items plus a manifest that describes fields and capabilities.
 */
export class LyraBundle<T extends Record<string, unknown>> {
  private static readonly SCRATCH_ARRAY_COUNT = 2;

  private readonly items: T[];
  private readonly manifest: LyraManifest;
  private readonly facetIndex: FacetPostingLists;
  private readonly scratchA: number[];
  private readonly scratchB: number[];
  private readonly scratchRange: number[];

  private constructor(items: T[], manifest: LyraManifest, facetIndex: FacetPostingLists) {
    this.items = items;
    this.manifest = manifest;
    this.facetIndex = facetIndex;
    this.scratchA = [];
    this.scratchB = [];
    this.scratchRange = [];
  }

  /**
   * Build a new bundle from raw items and bundle configuration.
   */
  static async create<TItem extends Record<string, unknown>>(
    items: TItem[],
    config: CreateBundleConfig<TItem>,
  ): Promise<LyraBundle<TItem>> {
    // Soft validation: check that field names exist in at least one item
    if (items.length > 0) {
      const sampleItem = items[0] as Record<string, unknown>;
      const itemKeys = new Set(Object.keys(sampleItem));

      for (const fieldName of Object.keys(config.fields)) {
        if (!itemKeys.has(fieldName)) {
          // Check if any item has this field
          const hasField = items.some(
            (item) => (item as Record<string, unknown>)[fieldName] !== undefined,
          );
          if (!hasField) {
            // Soft warning - field doesn't exist in any item
            // eslint-disable-next-line no-console
            console.warn(
              `Field "${fieldName}" is configured but does not exist in any items. It will be ignored.`,
            );
          }
        }
      }
    }

    const manifest = buildManifest(config);
    const facetIndex = buildFacetIndex(items, manifest);
    return new LyraBundle(items, manifest, facetIndex);
  }

  /**
   * Return an empty result with the given applied filters.
   * @internal
   */
  private emptyResult(applied: {
    facets?: LyraQuery['facets'];
    ranges?: LyraQuery['ranges'];
  }): LyraResult<T> {
    return {
      items: [],
      total: 0,
      applied,
      facets: undefined,
      snapshot: this.snapshot(),
    };
  }

  /**
   * Compute candidate indices for a single facet object.
   * All fields within the facet object are intersected (AND logic).
   * @internal
   */
  private getSingleFacetCandidates(facetObj: Record<string, FacetValue>): number[] {
    if (Object.keys(facetObj).length === 0) {
      // All indices
      return Array.from({ length: this.items.length }, (_unused, i) => i);
    }

    const facetEntries: Array<{ postings: number[]; size: number }> = [];

    for (const [field, value] of Object.entries(facetObj)) {
      const postingsForField = this.facetIndex[field];
      if (!postingsForField) {
        // Field not indexed as facet; no matches
        return [];
      }

      const values = Array.isArray(value) ? value : [value];
      
      // Single-value fast path: skip mergeUnionSorted for common case
      if (values.length === 1) {
        const valueKey = String(values[0]);
        const postings = postingsForField[valueKey];
        if (!postings || postings.length === 0) {
          return [];
        }
        facetEntries.push({
          postings,
          size: postings.length,
        });
        continue;
      }

      // Multi-value case: collect postings arrays
      const postingsArrays: number[][] = [];
      for (const facetValue of values) {
        const valueKey = String(facetValue);
        const postings = postingsForField[valueKey];
        if (postings && postings.length > 0) {
          postingsArrays.push(postings);
        }
      }

      if (postingsArrays.length === 0) {
        return [];
      }

      // Merge postings for this facet (union for "IN" semantics)
      const mergedPostings = arrayOperations.mergeUnionSorted(postingsArrays);
      const estimatedSize = mergedPostings.length;

      facetEntries.push({
        postings: mergedPostings,
        size: estimatedSize,
      });
    }

    // Sort facets by estimated size ascending
    facetEntries.sort((entryA, entryB) => entryA.size - entryB.size);

    // Intersect facets in order of increasing size
    let candidateIndices: number[] | null = null;

    for (let i = 0; i < facetEntries.length; i++) {
      const facetEntry = facetEntries[i];

      if (candidateIndices === null) {
        // Seed with smallest facet's postings
        candidateIndices = facetEntry.postings;
      }
      else {
        // Intersect with next facet using scratch arrays
        const source = candidateIndices;
        const target =
          i % LyraBundle.SCRATCH_ARRAY_COUNT === 0 ? this.scratchA : this.scratchB;

        arrayOperations.intersectSorted(source, facetEntry.postings, target);
        candidateIndices = target;

        // Early-out if intersection is empty
        if (candidateIndices.length === 0) break;
      }
    }

    if (candidateIndices === null) {
      return Array.from({ length: this.items.length }, (_unused, i) => i);
    }

    return candidateIndices;
  }

  /**
   * Compute candidate indices based on facet filters (array of facet objects).
   * Combines results based on the specified mode.
   * @internal
   */
  private getFacetCandidates(
    facetObjs: Array<Record<string, FacetValue>>,
    mode: FacetMode,
  ): number[] {
    if (facetObjs.length === 0) {
      // No facet filters; return all indices
      return Array.from({ length: this.items.length }, (_unused, i) => i);
    }

    // Get candidates for each facet object
    const candidateSets: number[][] = [];
    for (const facetObj of facetObjs) {
      const candidates = this.getSingleFacetCandidates(facetObj);
      if (candidates.length > 0) {
        candidateSets.push(candidates);
      }
      else if (mode === 'intersection') {
        // Early exit for intersection if any set is empty
        return [];
      }
    }

    if (candidateSets.length === 0) {
      return [];
    }

    if (candidateSets.length === 1) {
      return candidateSets[0];
    }

    // Combine candidate sets based on mode
    if (mode === 'union') {
      return arrayOperations.mergeUnionSorted(candidateSets);
    }
    else {
      // Intersection mode: start with first set and intersect with others
      let result = candidateSets[0];
      for (let i = 1; i < candidateSets.length; i++) {
        const target = i % LyraBundle.SCRATCH_ARRAY_COUNT === 0 ? this.scratchA : this.scratchB;
        arrayOperations.intersectSorted(result, candidateSets[i], target);
        result = target;
        
        // Early exit if intersection is empty
        if (result.length === 0) {
          return [];
        }
      }
      return result;
    }
  }

  /**
   * Apply a single range filter object to candidate indices.
   * @internal
   */
  private getSingleRangeCandidates(
    startIndices: number[],
    rangeObj: Record<string, RangeFilter>,
  ): number[] {
    if (Object.keys(rangeObj).length === 0) {
      return startIndices;
    }

    // Validate range fields
    const rangeFields = Object.keys(rangeObj);
    const validRangeFields = new Set(this.manifest.capabilities.ranges);
    const hasInvalidRangeField = rangeFields.some((field) => !validRangeFields.has(field));
    if (hasInvalidRangeField) {
      return [];
    }

    // Build field type map for range fields in query
    const fieldTypes: Record<string, FieldType> = {};
    for (const field of rangeFields) {
      const fieldDef = this.manifest.fields.find((fieldDefinition) => fieldDefinition.name === field);
      if (fieldDef) {
        fieldTypes[field] = fieldDef.type;
      }
    }

    // Reuse scratch array for range filtering
    arrayOperations.filterIndicesByRange(
      startIndices,
      this.items,
      rangeObj,
      fieldTypes,
      this.scratchRange,
    );
    return this.scratchRange.slice(); // Return a copy to avoid overwriting
  }

  /**
   * Compute candidate indices based on range filters (array of range objects).
   * Combines results based on the specified mode.
   * @internal
   */
  private getRangeCandidates(
    startIndices: number[],
    rangeObjs: Array<Record<string, RangeFilter>>,
    mode: RangeMode,
  ): number[] {
    if (rangeObjs.length === 0) {
      // No range filters; return input indices unchanged
      return startIndices;
    }

    // Get candidates for each range object
    const candidateSets: number[][] = [];
    for (const rangeObj of rangeObjs) {
      const candidates = this.getSingleRangeCandidates(startIndices, rangeObj);
      if (candidates.length > 0) {
        candidateSets.push(candidates);
      }
      else if (mode === 'intersection') {
        // Early exit for intersection if any set is empty
        return [];
      }
    }

    if (candidateSets.length === 0) {
      return [];
    }

    if (candidateSets.length === 1) {
      return candidateSets[0];
    }

    // Combine candidate sets based on mode
    if (mode === 'union') {
      return arrayOperations.mergeUnionSorted(candidateSets);
    }
    else {
      // Intersection mode: start with first set and intersect with others
      let result = candidateSets[0];
      for (let i = 1; i < candidateSets.length; i++) {
        const target = i % LyraBundle.SCRATCH_ARRAY_COUNT === 0 ? this.scratchA : this.scratchB;
        arrayOperations.intersectSorted(result, candidateSets[i], target);
        result = target;
        
        // Early exit if intersection is empty
        if (result.length === 0) {
          return [];
        }
      }
      return result;
    }
  }

  /**
   * Compute facet counts for the given candidate indices.
   * @internal
   */
  private computeFacetCounts(indices: number[]): FacetCounts {
    const facetCounts: FacetCounts = {};
    // Cache frequently accessed values
    const facetFields = this.manifest.capabilities.facets;
    const items = this.items;
    const numFacets = facetFields.length;

    // Pre-initialize facetCounts objects
    for (let i = 0; i < numFacets; i++) {
      const field = facetFields[i];
      facetCounts[field] = {};
    }

    // Iterate through indices that passed both facet and range filters
    for (const idx of indices) {
      const item = items[idx] as Record<string, unknown>;
      
      for (let i = 0; i < numFacets; i++) {
        const field = facetFields[i];
        const raw = item[field];
        if (raw === undefined || raw === null) continue;

        // Avoid array wrapping for scalar values
        const countsForField = facetCounts[field];
        
        if (Array.isArray(raw)) {
          for (const value of raw) {
            const valueKey = String(value);
            countsForField[valueKey] = (countsForField[valueKey] ?? 0) + 1;
          }
        }
        else {
          const valueKey = String(raw);
          countsForField[valueKey] = (countsForField[valueKey] ?? 0) + 1;
        }
      }
    }

    return facetCounts;
  }

  /**
   * Execute a facet/range query against the bundle.
   *
   * Query contract:
   * - Unknown facet fields: treated as "no matches" (returns total = 0)
   * - Unknown range fields: treated as "no matches" (returns total = 0)
   * - Negative offset: clamped to 0
   * - Negative limit: treated as 0 (no results)
   * - facetMode and rangeMode default to 'union'
   */
  query(query: LyraQuery = {}): LyraResult<T> {
    const { 
      facets, 
      ranges, 
      facetMode = 'union',
      rangeMode = 'union',
      limit, 
      offset, 
      includeFacetCounts = false,
    } = query;

    // Normalize facets and ranges to array format
    const normalizedFacets = normalizeFacets(facets);
    const normalizedRanges = normalizeRanges(ranges);

    // Cache manifest lookups
    const items = this.items;

    // Normalize offset and limit
    const normalizedOffset = offset != null && offset < 0 ? 0 : (offset ?? 0);
    const normalizedLimit = limit != null && limit < 0 ? 0 : limit;

    // Get candidate indices from facet filters
    let candidateIndices = this.getFacetCandidates(normalizedFacets, facetMode);

    // Apply range filters on indices
    // Note: Range min/max must be numbers; for dates, use epoch milliseconds (e.g., Date.parse(isoString))
    candidateIndices = this.getRangeCandidates(candidateIndices, normalizedRanges, rangeMode);

    const total = candidateIndices.length;

    // Compute facet counts if requested
    const facetCounts = includeFacetCounts ? this.computeFacetCounts(candidateIndices) : undefined;

    // Apply pagination on indices (using normalized values)
    const start = normalizedOffset;
    const end = normalizedLimit != null ? start + normalizedLimit : undefined;
    const paginatedIndices = candidateIndices.slice(start, end);

    // Convert indices to items only for the final paginated slice
    const resultItems = paginatedIndices.map((idx) => items[idx]);

    return {
      items: resultItems,
      total,
      applied: {
        facets,
        ranges,
      },
      facets: facetCounts,
      snapshot: this.snapshot(),
    };
  }

  /**
   * Get a summary of distinct values and counts for a facet field.
   *
   * Useful for building dropdowns and drilldown UIs. Returns distinct values
   * and their counts for a single facet field, optionally filtered by other
   * facets or ranges.
   *
   * @param field - The facet field name to summarize
   * @param options - Optional filters to apply before counting
   * @returns Summary object with field name and array of value/count pairs
   *
   * @example
   * ```ts
   * // Get all distinct status values and counts
   * const summary = bundle.getFacetSummary('status');
   * // { field: 'status', values: [{ value: 'open', count: 5 }, ...] }
   *
   * // Get status values under current filters
   * const filteredSummary = bundle.getFacetSummary('status', {
   *   facets: { customerId: 'C-ACME' }
   * });
   * ```
   */
  getFacetSummary(
    field: string,
    options?: { facets?: LyraQuery['facets']; ranges?: LyraQuery['ranges'] },
  ): { field: string; values: Array<{ value: string | number | boolean; count: number }> } {
    // Robust field validation: check both capabilities and field kind
    const fieldDef = this.manifest.fields.find((fieldDef) => fieldDef.name === field);
    if (
      !fieldDef ||
      fieldDef.kind !== 'facet' ||
      !this.manifest.capabilities.facets.includes(field)
    ) {
      return { field, values: [] };
    }

    // Query with includeFacetCounts, limit: 0 to avoid materializing items
    const result = this.query({
      facets: options?.facets,
      ranges: options?.ranges,
      includeFacetCounts: true,
      limit: 0,
      offset: 0,
    });

    // Extract facet counts with safe fallback
    const rawCounts = result.facets?.[field] ?? {};

    // Convert string keys back to typed values
    const values: Array<{ value: string | number | boolean; count: number }> = [];
    for (const [key, count] of Object.entries(rawCounts)) {
      const typedValue = parseFacetKey(fieldDef.type, key);
      values.push({ value: typedValue, count });
    }

    // Sort by value for stable ordering
    values.sort((first, second) => {
      if (typeof first.value === 'number' && typeof second.value === 'number') {
        return first.value - second.value;
      }
      if (typeof first.value === 'boolean' && typeof second.value === 'boolean') {
        return Number(first.value) - Number(second.value); // false (0) before true (1)
      }
      return String(first.value).localeCompare(String(second.value));
    });

    return { field, values };
  }

  /**
   * Return the bundle manifest describing fields and capabilities.
   */
  describe(): LyraManifest {
    return this.manifest;
  }

  /**
   * Return just the bundle snapshot metadata.
   */
  snapshot(): LyraSnapshotInfo {
    return {
      datasetId: this.manifest.datasetId,
      builtAt: this.manifest.builtAt,
      indexVersion: this.manifest.version,
    };
  }

  /**
   * Serialize the bundle to a plain JSON-compatible structure.
   *
   *! NOTE: Any structural change here must be reflected in docs/bundle-json-spec.md
   */
  toJSON(): LyraBundleJSON<T> {
    return {
      manifest: this.manifest,
      items: this.items,
      facetIndex: this.facetIndex,
    };
  }

  /**
   * Load a bundle from a previously serialized JSON value.
   *
   *! NOTE: Any structural change here must be reflected in docs/bundle-json-spec.md
   */
  static load<TItem extends Record<string, unknown>>(
    raw: LyraBundleJSON<TItem>,
  ): LyraBundle<TItem> {
    if (!raw || !raw.manifest || !raw.items) {
      throw new Error('Invalid bundle JSON: missing manifest or items');
    }

    const { manifest, items, facetIndex } = raw;

    // Validate version
    if (!manifest.version || !manifest.version.startsWith('1.')) {
      throw new Error(
        `Invalid bundle version: "${manifest.version}". Expected version starting with "1."`,
      );
    }

    // Validate that fields array is not empty
    if (!manifest.fields || manifest.fields.length === 0) {
      throw new Error('Invalid bundle: fields array must not be empty');
    }

    // Validate capabilities reference existing fields
    const fieldNames = new Set(manifest.fields.map((field) => field.name));

    for (const facetField of manifest.capabilities.facets) {
      if (!fieldNames.has(facetField)) {
        throw new Error(
          `Invalid bundle: capability references non-existent facet field "${facetField}"`,
        );
      }
    }

    for (const rangeField of manifest.capabilities.ranges) {
      if (!fieldNames.has(rangeField)) {
        throw new Error(
          `Invalid bundle: capability references non-existent range field "${rangeField}"`,
        );
      }
    }

    // Validate facetIndex keys match facet field names
    const facetIndexKeys = new Set(Object.keys(facetIndex ?? {}));
    const expectedFacetFields = new Set(manifest.capabilities.facets);

    for (const indexKey of facetIndexKeys) {
      if (!expectedFacetFields.has(indexKey)) {
        throw new Error(
          `Invalid bundle: facetIndex contains field "${indexKey}" that is not in capabilities.facets`,
        );
      }
    }

    // Ensure all facet fields have entries in facetIndex (empty is OK)
    // Lightweight guard: initialize empty object if facetIndex is missing
    const finalFacetIndex: FacetPostingLists = facetIndex ?? {};
    
    for (const facetField of manifest.capabilities.facets) {
      if (!(facetField in finalFacetIndex)) {
        finalFacetIndex[facetField] = {};
      }
    }

    return new LyraBundle<TItem>(items, manifest, finalFacetIndex);
  }
}

// Internal Helpers
// ==============================

/**
 * Parse a facet key string back to its typed value based on field type.
 * Used internally by getFacetSummary to convert string keys back to typed values.
 * @internal
 */
function parseFacetKey(fieldType: FieldType, key: string): string | number | boolean {
  switch (fieldType) {
    case 'number':
      return Number(key);
    case 'boolean':
      // 'true' -> true, anything else -> false (deterministic)
      return key === 'true';
    default:
      return key; // 'string' or 'date' (though date shouldn't be used here)
  }
}

/**
 * Normalize facets parameter from single object or array to array format.
 * @internal
 */
function normalizeFacets(
  facets: LyraQuery['facets'],
): Array<Record<string, FacetValue>> {
  if (facets == null) {
    return [];
  }
  return Array.isArray(facets) ? facets : [facets];
}

/**
 * Normalize ranges parameter from single object or array to array format.
 * @internal
 */
function normalizeRanges(
  ranges: LyraQuery['ranges'],
): Array<Record<string, RangeFilter>> {
  if (ranges == null) {
    return [];
  }
  return Array.isArray(ranges) ? ranges : [ranges];
}