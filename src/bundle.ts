import type {
  CreateBundleConfig,
  LyraManifest,
  LyraQuery,
  LyraResult,
  LyraSnapshotInfo,
} from './types';

// Types
// ==============================

type BundleItem = Record<string, unknown>;

type FacetPostingLists = {
  [field: string]: {
    [valueKey: string]: number[]; // item indices
  };
};

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

// Components
// ==============================

/**
 * Immutable bundle of items plus a manifest that describes fields and capabilities.
 */
export class LyraBundle<T extends BundleItem> {
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
  static async create<TItem extends BundleItem>(
    items: TItem[],
    config: CreateBundleConfig,
  ): Promise<LyraBundle<TItem>> {
    const builtAt = new Date().toISOString();

    const fields = Object.entries(config.fields).map(([name, cfg]) => ({
      name,
      kind: cfg.kind,
      type: cfg.type,
      ops: (
        cfg.kind === 'range'
          ? ['between', 'gte', 'lte']
          : ['eq', 'in']
      ) as Array<'eq' | 'in' | 'between' | 'gte' | 'lte'>,
    }));

    const manifest: LyraManifest = {
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

    // Build facet index
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

    return new LyraBundle(items, manifest, facetIndex);
  }

  /**
   * Execute a facet/range query against the bundle.
   */
  query(query: LyraQuery = {}): LyraResult<T> {
    const { facets, ranges, limit, offset } = query;
    const hasFacetFilters = facets && Object.keys(facets).length > 0;

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
      for (let facetIndex = 0; facetIndex < facetEntries.length; facetIndex++) {
        const facetEntry = facetEntries[facetIndex];

        if (candidateIndices === null) {
          // Seed with smallest facet's postings
          candidateIndices = facetEntry.postings;
        }
        else {
          // Intersect with next facet using scratch arrays
          const source = candidateIndices;
          const SCRATCH_ARRAY_COUNT = 2;
          const target = facetIndex % SCRATCH_ARRAY_COUNT === 0 ? this.scratchA : this.scratchB;

          intersectSorted(source, facetEntry.postings, target);
          candidateIndices = target;

          // Early-out if intersection is empty
          if (candidateIndices.length === 0) break;
        }
      }
    }

    // If no facet filters, start from all items.
    let items: T[];
    if (candidateIndices === null) {
      items = this.items;
    }
    else {
      items = candidateIndices.map((idx) => this.items[idx]);
    }

    // Apply range filters naively for now.
    if (ranges && Object.keys(ranges).length > 0) {
      items = items.filter((item) => {
        return Object.entries(ranges).every(([field, range]) => {
          const rawValue = (item as Record<string, unknown>)[field];
          if (rawValue == null) return false;

          const numericValue =
            typeof rawValue === 'number'
              ? rawValue
              : Date.parse(String(rawValue)) || NaN;

          if (Number.isNaN(numericValue)) return false;
          if (range.min != null && numericValue < range.min) return false;
          if (range.max != null && numericValue > range.max) return false;

          return true;
        });
      });
    }

    const total = items.length;
    const start = offset ?? 0;
    const end = limit != null ? start + limit : undefined;
    const slice = items.slice(start, end);

    const snapshot: LyraSnapshotInfo = {
      datasetId: this.manifest.datasetId,
      builtAt: this.manifest.builtAt,
      indexVersion: this.manifest.version,
    };

    return {
      items: slice,
      total,
      applied: {
        facets,
        ranges,
      },
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
   */
  toJSON(): unknown {
    return {
      manifest: this.manifest,
      items: this.items,
      facetIndex: this.facetIndex,
    };
  }

  /**
   * Load a bundle from a previously serialized JSON value.
   */
  static load<TItem extends BundleItem>(raw: {
    manifest?: LyraManifest;
    items?: TItem[];
    facetIndex?: FacetPostingLists;
  }): LyraBundle<TItem> {
    if (!raw || !raw.manifest || !raw.items) {
      throw new Error('Invalid bundle JSON');
    }

    const facetIndex: FacetPostingLists = raw.facetIndex ?? {};
    return new LyraBundle<TItem>(raw.items, raw.manifest, facetIndex);
  }
}