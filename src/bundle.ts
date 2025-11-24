import type {
  AnyBundleConfig,
  CreateBundleConfig,
  FacetCounts,
  FacetPostingLists,
  FieldType,
  LyraBundleJSON,
  LyraManifest,
  LyraQuery,
  LyraResult,
  LyraSnapshotInfo,
  SimpleBundleConfig,
} from './types';
import * as arrayOperations from './utils/array-operations';
import { buildFacetIndex, buildManifest } from './utils/builders';
import { fromSimpleConfig } from './utils/type-inference';


/**
 * Create a bundle from items and explicit configuration.
 */
export function createBundle<T extends Record<string, unknown>>(
  items: T[],
  config: CreateBundleConfig<T>,
): Promise<LyraBundle<T>>;

/**
 * Create a bundle from items and simple configuration.
 */
export function createBundle<T extends Record<string, unknown>>(
  items: T[],
  config: SimpleBundleConfig<T>,
): Promise<LyraBundle<T>>;

/**
 * Create a bundle from items and configuration.
 * Supports both explicit and simple configuration styles.
 */
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

// Utils
// ==============================

/**
 * Parse a facet key string back to its typed value based on field type.
 * @internal
 */
function parseFacetKey(fieldType: FieldType, key: string): string | number | boolean {
  switch (fieldType) {
    case 'number':
      return Number(key);
    case 'boolean':
      return key === 'true'; // 'false' -> false, any other string -> false (deterministic)
    default:
      return key; // 'string' or 'date' (though date shouldn't be used here)
  }
}

// Components
// ==============================

/**
 * Immutable bundle of items plus a manifest that describes fields and capabilities.
 */
export class LyraBundle<T extends Record<string, unknown>> {
  private readonly items: T[];
  private readonly manifest: LyraManifest;
  private readonly facetIndex: FacetPostingLists;
  private readonly scratchA: number[];
  private readonly scratchB: number[];

  private constructor(items: T[], manifest: LyraManifest, facetIndex: FacetPostingLists) {
    this.items = items;
    this.manifest = manifest;
    this.facetIndex = facetIndex;
    this.scratchA = [];
    this.scratchB = [];
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
   * Execute a facet/range query against the bundle.
   *
   * Query contract:
   * - Unknown facet fields: treated as "no matches" (returns total = 0)
   * - Unknown range fields: treated as "no matches" (returns total = 0)
   * - Negative offset: clamped to 0
   * - Negative limit: treated as 0 (no results)
   */
  query(query: LyraQuery = {}): LyraResult<T> {
    const { facets, ranges, limit, offset, includeFacetCounts = false } = query;
    const hasFacetFilters = facets && Object.keys(facets).length > 0;
    const hasRangeFilters = ranges && Object.keys(ranges).length > 0;

    // Pre-check: if any requested range field is not in capabilities.ranges, return empty result
    if (hasRangeFilters) {
      const rangeFields = Object.keys(ranges!);
      const validRangeFields = new Set(this.manifest.capabilities.ranges);
      const hasInvalidRangeField = rangeFields.some((field) => !validRangeFields.has(field));
      if (hasInvalidRangeField) {
        // Unknown range field; return empty result
        const snapshot: LyraSnapshotInfo = {
          datasetId: this.manifest.datasetId,
          builtAt: this.manifest.builtAt,
          indexVersion: this.manifest.version,
        };
        return {
          items: [],
          total: 0,
          applied: {
            facets,
            ranges,
          },
          facets: undefined,
          snapshot,
        };
      }
    }

    // Normalize offset and limit
    const normalizedOffset = offset != null && offset < 0 ? 0 : (offset ?? 0);
    const normalizedLimit = limit != null && limit < 0 ? 0 : limit;

    let candidateIndices: number[] | null = null;

    if (hasFacetFilters) {
      // Build array of facet entries with their postings and estimated sizes
      const facetEntries: Array<{
        field: string;
        postings: number[];
        size: number;
      }> = [];

      for (const [field, value] of Object.entries(facets!)) {
        const postingsForField = this.facetIndex[field];
        if (!postingsForField) {
          // Field not indexed as facet; no matches
          candidateIndices = [];
          break;
        }

        const values = Array.isArray(value) ? value : [value];
        const postingsArrays: number[][] = [];

        for (const facetValue of values) {
          const valueKey = String(facetValue);
          const postings = postingsForField[valueKey];
          if (postings && postings.length > 0) {
            postingsArrays.push(postings);
          }
        }

        if (postingsArrays.length === 0) {
          candidateIndices = [];
          break;
        }

        // Merge postings for this facet (union for "IN" semantics)
        const mergedPostings = arrayOperations.mergeUnionSorted(postingsArrays);
        const estimatedSize = mergedPostings.length;

        facetEntries.push({
          field,
          postings: mergedPostings,
          size: estimatedSize,
        });
      }

      // Sort facets by estimated size ascending
      facetEntries.sort((entryA, entryB) => entryA.size - entryB.size);

      // Intersect facets in order of increasing size
      for (let i = 0; i < facetEntries.length; i++) {
        const facetEntry = facetEntries[i];

        if (candidateIndices === null) {
          // Seed with smallest facet's postings
          candidateIndices = facetEntry.postings;
        }
        else {
          // Intersect with next facet using scratch arrays
          const source = candidateIndices;
          const SCRATCH_ARRAY_COUNT = 2;
          const target = i % SCRATCH_ARRAY_COUNT === 0 ? this.scratchA : this.scratchB;

          arrayOperations.intersectSorted(source, facetEntry.postings, target);
          candidateIndices = target;

          // Early-out if intersection is empty
          if (candidateIndices.length === 0) break;
        }
      }
    }

    // Initialize candidateIndices if no facet filters
    if (candidateIndices === null) {
      // Create array of all indices
      candidateIndices = new Array(this.items.length);
      for (let i = 0; i < this.items.length; i++) {
        candidateIndices[i] = i;
      }
    }

    // Apply range filters on indices (optimized)
    // Note: Range min/max must be numbers; for dates, use epoch milliseconds (e.g., Date.parse(isoString))
    if (hasRangeFilters) {
      candidateIndices = arrayOperations.filterIndicesByRange(candidateIndices, this.items, ranges!);
    }

    const total = candidateIndices.length;

    // Compute facet counts if requested (iterate over indices for efficiency)
    let facetCounts: FacetCounts | undefined;
    if (includeFacetCounts) {
      facetCounts = {};
      const facetFields = this.manifest.capabilities.facets;

      for (const field of facetFields) {
        facetCounts[field] = {};
      }

      // Iterate through indices that passed both facet and range filters
      for (const idx of candidateIndices) {
        const item = this.items[idx];
        for (const field of facetFields) {
          const raw = (item as Record<string, unknown>)[field];
          if (raw === undefined || raw === null) continue;

          // Handle array values (count each occurrence)
          const values = Array.isArray(raw) ? raw : [raw];

          for (const value of values) {
            const valueKey = String(value);
            const countsForField = facetCounts[field];
            countsForField[valueKey] = (countsForField[valueKey] ?? 0) + 1;
          }
        }
      }
    }

    // Apply pagination on indices (using normalized values)
    const start = normalizedOffset;
    const end = normalizedLimit != null ? start + normalizedLimit : undefined;
    const paginatedIndices = candidateIndices.slice(start, end);

    // Convert indices to items only for the final paginated slice
    const items = paginatedIndices.map((idx) => this.items[idx]);

    const snapshot: LyraSnapshotInfo = {
      datasetId: this.manifest.datasetId,
      builtAt: this.manifest.builtAt,
      indexVersion: this.manifest.version,
    };

    return {
      items,
      total,
      applied: {
        facets,
        ranges,
      },
      facets: facetCounts,
      snapshot,
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
    const fieldDef = this.manifest.fields.find((f) => f.name === field);
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
    values.sort((a, b) => {
      if (typeof a.value === 'number' && typeof b.value === 'number') {
        return a.value - b.value;
      }
      if (typeof a.value === 'boolean' && typeof b.value === 'boolean') {
        return Number(a.value) - Number(b.value); // false (0) before true (1)
      }
      return String(a.value).localeCompare(String(b.value));
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
   * NOTE: Any structural change here must be reflected in docs/bundle-json-spec.md
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
   * NOTE: Any structural change here must be reflected in docs/bundle-json-spec.md
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