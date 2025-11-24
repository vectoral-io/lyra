import type {
  CreateBundleConfig,
  FacetCounts,
  FacetPostingLists,
  FieldKind,
  FieldType,
  LyraBundleJSON,
  LyraManifest,
  LyraQuery,
  LyraResult,
  LyraSnapshotInfo,
  RangeFilter,
} from './types';


// Utils
// ==============================

/**
 * Merge multiple sorted arrays into a single sorted, deduplicated array.
 * Uses two-pointer merge approach for efficiency.
 */
function mergeUnionSorted(arrays: number[][]): number[] {
  if (arrays.length === 0) return [];
  if (arrays.length === 1) return arrays[0];

  const result: number[] = [];
  const pointers: number[] = new Array(arrays.length).fill(0);

  while (true) {
    let minValue = Infinity;
    let minIndex = -1;

    // Find the minimum value across all arrays
    for (let arrayIndex = 0; arrayIndex < arrays.length; arrayIndex++) {
      const pointer = pointers[arrayIndex];
      const array = arrays[arrayIndex];
      if (pointer < array.length) {
        const value = array[pointer];
        if (value < minValue) {
          minValue = value;
          minIndex = arrayIndex;
        }
      }
    }

    if (minIndex === -1) break; // All arrays exhausted

    // Add minValue to result (skip if duplicate)
    if (result.length === 0 || result[result.length - 1] !== minValue) {
      result.push(minValue);
    }

    // Advance all pointers that point to minValue
    for (let arrayIndex = 0; arrayIndex < arrays.length; arrayIndex++) {
      const pointer = pointers[arrayIndex];
      const array = arrays[arrayIndex];
      if (pointer < array.length && array[pointer] === minValue) {
        pointers[arrayIndex]++;
      }
    }
  }

  return result;
}


/**
 * Intersect two sorted arrays using two-pointer algorithm.
 * Writes result to target array (clears and reuses it).
 */
function intersectSorted(
  listA: number[],
  listB: number[],
  target: number[],
): void {
  target.length = 0; // Clear target array

  let pointerA = 0;
  let pointerB = 0;

  while (pointerA < listA.length && pointerB < listB.length) {
    const valueA = listA[pointerA];
    const valueB = listB[pointerB];

    if (valueA < valueB) {
      pointerA++;
    }
    else if (valueA > valueB) {
      pointerB++;
    }
    else {
      // Values match
      target.push(valueA);
      pointerA++;
      pointerB++;
    }
  }
}


/**
 * Filter indices array by range conditions, checking items at those indices.
 * Returns a new array of indices that pass all range filters.
 * 
 * Range semantics:
 * - Range `min` and `max` values must be numbers
 * - For date fields, pass epoch milliseconds (e.g., `Date.parse(isoString)`)
 * - Items are included if their value is >= `min` (if provided) and <= `max` (if provided)
 */
function filterIndicesByRange<T extends Record<string, unknown>>(
  indices: number[],
  items: T[],
  ranges: Record<string, RangeFilter>,
): number[] {
  const result: number[] = [];

  for (const idx of indices) {
    const item = items[idx];
    let passes = true;

    for (const [field, range] of Object.entries(ranges)) {
      const rawValue = (item as Record<string, unknown>)[field];
      if (rawValue == null) {
        passes = false;
        break;
      }

      const numericValue =
        typeof rawValue === 'number'
          ? rawValue
          : Date.parse(String(rawValue)) || NaN;

      if (Number.isNaN(numericValue)) {
        passes = false;
        break;
      }
      if (range.min != null && numericValue < range.min) {
        passes = false;
        break;
      }
      if (range.max != null && numericValue > range.max) {
        passes = false;
        break;
      }
    }

    if (passes) {
      result.push(idx);
    }
  }

  return result;
}


// Builder Functions
// ==============================

/**
 * Build a manifest from bundle configuration.
 * @internal
 */
function buildManifest<TItem extends Record<string, unknown>>(
  config: CreateBundleConfig<TItem>,
): LyraManifest {
  const builtAt = new Date().toISOString();

  const VALID_KINDS: FieldKind[] = ['id', 'facet', 'range', 'meta'];
  const VALID_TYPES: FieldType[] = ['string', 'number', 'boolean', 'date'];

  const fields = Object.entries(config.fields)
    .filter(([, cfg]) => cfg != null) // Filter out undefined entries
    .map(([name, cfg]) => {
      // cfg is guaranteed to be defined after filter
      if (!cfg) {
        throw new Error(`Field "${name}" has undefined configuration`);
      }

      // Validate kind
      if (!VALID_KINDS.includes(cfg.kind)) {
        throw new Error(
          `Invalid field kind "${cfg.kind}" for field "${name}". Must be one of: ${VALID_KINDS.join(', ')}`,
        );
      }

      // Validate type
      if (!VALID_TYPES.includes(cfg.type)) {
        throw new Error(
          `Invalid field type "${cfg.type}" for field "${name}". Must be one of: ${VALID_TYPES.join(', ')}`,
        );
      }

      return {
        name,
        kind: cfg.kind,
        type: cfg.type,
        ops: (
          cfg.kind === 'range'
            ? ['between', 'gte', 'lte']
            : ['eq', 'in']
        ) as Array<'eq' | 'in' | 'between' | 'gte' | 'lte'>,
      };
    });

  // Validate that at least one field is defined
  if (fields.length === 0) {
    throw new Error('Invalid bundle: fields array must not be empty');
  }

  return {
    version: '1.0.0',
    datasetId: config.datasetId,
    builtAt,
    fields,
    capabilities: {
      facets: fields
        .filter((field) => field.kind === 'facet')
        .map((field) => field.name),
      ranges: fields
        .filter((field) => field.kind === 'range')
        .map((field) => field.name),
    },
  };
}


/**
 * Build facet index from items and manifest.
 * @internal
 */
function buildFacetIndex<T extends Record<string, unknown>>(
  items: T[],
  manifest: LyraManifest,
): FacetPostingLists {
  const facetFields = manifest.capabilities.facets;
  const facetIndex: FacetPostingLists = {};

  for (const field of facetFields) {
    facetIndex[field] = {};
  }

  items.forEach((item, idx) => {
    for (const field of facetFields) {
      const raw = (item as Record<string, unknown>)[field];
      if (raw === undefined || raw === null) continue;

      // For now treat non-array values as singletons
      const values = Array.isArray(raw) ? raw : [raw];

      for (const value of values) {
        const valueKey = String(value);
        const postingsForField = facetIndex[field];
        let postings = postingsForField[valueKey];
        if (!postings) {
          postings = [];
          postingsForField[valueKey] = postings;
        }
        postings.push(idx);
      }
    }
  });

  // Sort and deduplicate posting lists at build time
  for (const field of facetFields) {
    const postingsForField = facetIndex[field];
    for (const valueKey in postingsForField) {
      const postings = postingsForField[valueKey];
      // Sort ascending
      postings.sort((valueA, valueB) => valueA - valueB);
      // Deduplicate in-place (remove consecutive duplicates after sorting)
      let writeIndex = 0;
      for (let readIndex = 0; readIndex < postings.length; readIndex++) {
        if (readIndex === 0 || postings[readIndex] !== postings[readIndex - 1]) {
          postings[writeIndex] = postings[readIndex];
          writeIndex++;
        }
      }
      postings.length = writeIndex;
    }
  }

  return facetIndex;
}


/**
 * Create a bundle from items and configuration.
 */
export async function createBundle<T extends Record<string, unknown>>(
  items: T[],
  config: CreateBundleConfig<T>,
): Promise<LyraBundle<T>> {
  return LyraBundle.create(items, config);
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
        const mergedPostings = mergeUnionSorted(postingsArrays);
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

          intersectSorted(source, facetEntry.postings, target);
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
      candidateIndices = filterIndicesByRange(candidateIndices, this.items, ranges!);
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