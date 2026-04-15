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
  NullPostingLists,
  Scalar,
  SimpleBundleConfig,
} from './types';
import { enrichItems, getAliasValues } from './aliases';
import { filterByExclusions, filterByNullChecks, filterByRanges } from './query/filters';
import { normalizeQuery, resolveAliases } from './query/normalize';
import * as arrayOps from './utils/array-operations';
import {
  BUNDLE_VERSION,
  buildFacetIndex,
  buildLookupTablesFromData,
  buildManifest,
  buildNullIndex,
  validateManifest,
} from './utils/builders';
import { fromSimpleConfig } from './utils/type-inference';


/**
 * Create a bundle from items.
 *
 * Overloads:
 * - Explicit config: full control over field kinds/types via `CreateBundleConfig`.
 * - Simple config: ergonomic `SimpleBundleConfig` that infers types from data.
 */
export function createBundle<T extends Record<string, unknown>>(
  items: T[],
  config: CreateBundleConfig<T>,
): Promise<LyraBundle<T>>;
export function createBundle<T extends Record<string, unknown>>(
  items: T[],
  config: SimpleBundleConfig<T>,
): Promise<LyraBundle<T>>;
export async function createBundle<T extends Record<string, unknown>>(
  items: T[],
  config: AnyBundleConfig<T>,
): Promise<LyraBundle<T>> {
  const explicit: CreateBundleConfig<T> =
    'fields' in config ? config : fromSimpleConfig(items, config as SimpleBundleConfig<T>);
  return LyraBundle.create(items, explicit);
}


/**
 * Immutable bundle of items plus a manifest that describes fields and capabilities.
 */
export class LyraBundle<T extends Record<string, unknown>> {
  private readonly items: T[];
  private readonly manifest: LyraManifest;
  private readonly facetIndex: FacetPostingLists;
  private readonly nullIndex: NullPostingLists;

  // Cached [0..items.length) for empty-query fast path. Callers must treat as read-only.
  private readonly allIndices: number[];

  // Scratch buffers for the query pipeline. Each stage owns its own buffer so
  // stages can never alias each other's input or output.
  private readonly scratchEqual: number[] = [];
  private readonly scratchRange: number[] = [];
  private readonly scratchNull: number[] = [];
  private readonly scratchExcl: number[] = [];

  private constructor(
    items: T[],
    manifest: LyraManifest,
    facetIndex: FacetPostingLists,
    nullIndex: NullPostingLists,
  ) {
    this.items = items;
    this.manifest = manifest;
    this.facetIndex = facetIndex;
    this.nullIndex = nullIndex;
    this.allIndices = Array.from({ length: items.length }, (_unused, index) => index);
  }

  /**
   * Build a new bundle from raw items and bundle configuration.
   */
  static async create<TItem extends Record<string, unknown>>(
    items: TItem[],
    config: CreateBundleConfig<TItem>,
  ): Promise<LyraBundle<TItem>> {
    // Soft validation: warn on configured fields missing from all items.
    if (items.length > 0) {
      const sampleKeys = new Set(Object.keys(items[0] as Record<string, unknown>));
      for (const fieldName of Object.keys(config.fields)) {
        if (sampleKeys.has(fieldName)) continue;
        const present = items.some(
          (item) => (item as Record<string, unknown>)[fieldName] !== undefined,
        );
        if (!present) {
          // eslint-disable-next-line no-console
          console.warn(
            `Field "${fieldName}" is configured but does not exist in any items. It will be ignored.`,
          );
        }
      }
    }

    const manifest = buildManifest(config);

    // Auto-generate alias lookup tables.
    let finalManifest = manifest;
    if (manifest.capabilities.aliases && manifest.capabilities.aliases.length > 0) {
      const aliasMappings: Record<string, string> = {};
      for (const field of manifest.fields) {
        if (field.kind === 'alias' && field.aliasTarget) {
          aliasMappings[field.name] = field.aliasTarget;
        }
      }
      if (Object.keys(aliasMappings).length > 0) {
        finalManifest = {
          ...manifest,
          lookups: buildLookupTablesFromData(items, aliasMappings),
        };
      }
    }

    const facetIndex = buildFacetIndex(items, finalManifest);
    const nullIndex = buildNullIndex(items, finalManifest);
    return new LyraBundle(items, finalManifest, facetIndex, nullIndex);
  }

  /**
   * Execute a query against the bundle.
   *
   * Query contract:
   * - Unknown fields: treated as "no matches" (returns total = 0).
   * - Negative offset: clamped to 0.
   * - Negative limit: treated as 0 (no results).
   * - All operators are intersected (AND logic).
   */
  query(query: LyraQuery = {}): LyraResult<T> {
    const normalized = normalizeQuery(query);
    // Alias resolution is only needed when the bundle declares aliases. Most queries
    // against aliasless bundles should skip this — it's pure overhead otherwise.
    const hasAliases =
      this.manifest.capabilities.aliases !== undefined
      && this.manifest.capabilities.aliases.length > 0;
    const resolvedEqual = hasAliases
      ? resolveAliases(normalized.equalFilters, this.manifest, 'equal')
      : normalized.equalFilters;
    const resolvedNotEqual = hasAliases
      ? resolveAliases(normalized.notEqualFilters, this.manifest, 'notEqual')
      : normalized.notEqualFilters;

    // 1. Equal candidates.
    let candidates = this.getEqualCandidates(resolvedEqual);

    // 2. Union in null-matching indices for any `equal: { field: [val, null] }` fields.
    if (normalized.equalWithNull.size > 0) {
      const nullLists: number[][] = [];
      for (const field of normalized.equalWithNull) {
        const nulls = this.nullIndex[field];
        if (nulls && nulls.length > 0) nullLists.push(nulls);
      }
      if (nullLists.length > 0) {
        candidates = arrayOps.mergeUnionSorted([candidates, ...nullLists]);
      }
    }

    // 3. Range filters.
    if (Object.keys(normalized.rangeFilters).length > 0) {
      const rangeFields = Object.keys(normalized.rangeFilters);
      const validRanges = new Set(this.manifest.capabilities.ranges);
      if (rangeFields.some((field) => !validRanges.has(field))) {
        return this.emptyResult(query);
      }
      const fieldTypes = this.buildRangeFieldTypes(rangeFields);
      candidates = filterByRanges(
        candidates,
        this.items,
        normalized.rangeFilters,
        fieldTypes,
        this.scratchRange,
      ).slice();
    }

    // 4. Null checks (skip fields already covered by equalWithNull).
    const hasNullChecks =
      normalized.nullChecks.isNull.length > 0 || normalized.nullChecks.isNotNull.length > 0;
    if (hasNullChecks) {
      const explicitNullChecks = {
        isNull: normalized.nullChecks.isNull.filter((field) => !normalized.equalWithNull.has(field)),
        isNotNull: normalized.nullChecks.isNotNull,
      };
      candidates = filterByNullChecks(
        candidates,
        this.items,
        explicitNullChecks,
        this.nullIndex,
        this.scratchNull,
      );
      if (candidates === this.scratchNull) candidates = candidates.slice();
    }

    // 5. Exclusions.
    if (Object.keys(resolvedNotEqual).length > 0) {
      candidates = filterByExclusions(candidates, this.items, resolvedNotEqual, this.scratchExcl);
      if (candidates === this.scratchExcl) candidates = candidates.slice();
    }

    // 6. Facet counts (canonical facets only).
    const total = candidates.length;
    const facets = query.includeFacetCounts
      ? this.computeFacetCounts(candidates, this.manifest.capabilities.facets)
      : undefined;

    // 7. Pagination.
    const start = Math.max(0, query.offset ?? 0);
    const end = query.limit != null ? start + Math.max(0, query.limit) : undefined;
    const pageIndices = candidates.slice(start, end);
    let resultItems: T[] = pageIndices.map((idx) => this.items[idx]);

    // 8. Optional alias enrichment (opt-in).
    if (this.manifest.capabilities.aliases && this.manifest.capabilities.aliases.length > 0) {
      const shouldEnrich =
        query.enrichAliases === true ||
        (Array.isArray(query.enrichAliases) && query.enrichAliases.length > 0);
      if (shouldEnrich) {
        const fields = Array.isArray(query.enrichAliases)
          ? query.enrichAliases.filter((field) => this.manifest.capabilities.aliases!.includes(field))
          : this.manifest.capabilities.aliases;
        resultItems = enrichItems(resultItems, fields, this.manifest);
      }
    }

    return {
      items: resultItems,
      total,
      applied: {
        equal: query.equal,
        notEqual: query.notEqual,
        ranges: query.ranges,
        isNull: query.isNull,
        isNotNull: query.isNotNull,
      },
      facets,
      snapshot: this.snapshot(),
    };
  }

  /**
   * Get a summary of distinct values and counts for a facet field.
   *
   * Returns distinct values and their counts, optionally filtered by other facets or ranges.
   */
  getFacetSummary(
    field: string,
    options?: { equal?: LyraQuery['equal']; ranges?: LyraQuery['ranges'] },
  ): { field: string; values: Array<{ value: string | number | boolean; count: number }> } {
    const fieldDef = this.manifest.fields.find((fieldDefinition) => fieldDefinition.name === field);
    if (
      !fieldDef ||
      fieldDef.kind !== 'facet' ||
      !this.manifest.capabilities.facets.includes(field)
    ) {
      return { field, values: [] };
    }

    const result = this.query({
      equal: options?.equal,
      ranges: options?.ranges,
      includeFacetCounts: true,
      limit: 0,
      offset: 0,
    });

    const rawCounts = result.facets?.[field] ?? {};
    const values: Array<{ value: string | number | boolean; count: number }> = [];
    for (const [key, count] of Object.entries(rawCounts)) {
      values.push({ value: parseFacetKey(fieldDef.type, key), count });
    }

    values.sort((first, second) => {
      if (typeof first.value === 'number' && typeof second.value === 'number') {
        return first.value - second.value;
      }
      if (typeof first.value === 'boolean' && typeof second.value === 'boolean') {
        return Number(first.value) - Number(second.value);
      }
      return String(first.value).localeCompare(String(second.value));
    });

    return { field, values };
  }

  /**
   * Look up alias values for a single canonical ID.
   *
   * @example
   * ```ts
   * bundle.getAliasValues('zone_name', 'Z-001'); // ['Zone A']
   * ```
   */
  getAliasValues(aliasField: string, canonicalId: string | number): string[] {
    return getAliasValues(this.manifest, aliasField, canonicalId);
  }

  /**
   * Enrich a list of items with alias fields by batch lookup.
   *
   * Deduplicates canonical IDs so N items only trigger K lookups (K = unique IDs).
   * Returns new item objects; originals are not mutated.
   *
   * @example
   * ```ts
   * const result = bundle.query({ equal: { zone_id: 'Z-001' } });
   * const enriched = bundle.enrichItems(result.items, ['zone_name', 'zone_label']);
   * // enriched[0].zone_name === ['Zone A']
   * ```
   */
  enrichItems(
    items: T[],
    aliasFields: string[],
  ): Array<T & Record<string, string[]>> {
    return enrichItems(items, aliasFields, this.manifest);
  }

  /**
   * Return the bundle manifest describing fields and capabilities.
   */
  describe(): LyraManifest {
    return this.manifest;
  }

  /**
   * Return the bundle snapshot metadata.
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
      nullIndex: this.nullIndex,
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

    const { manifest, items } = raw;
    validateManifest(manifest);

    const facetIndex: FacetPostingLists = raw.facetIndex ?? {};
    const nullIndex: NullPostingLists = raw.nullIndex ?? {};

    // Cross-check facetIndex against capabilities.
    for (const indexKey of Object.keys(facetIndex)) {
      if (!manifest.capabilities.facets.includes(indexKey)) {
        throw new Error(
          `Invalid bundle: facetIndex contains field "${indexKey}" that is not in capabilities.facets`,
        );
      }
    }
    for (const facetField of manifest.capabilities.facets) {
      if (!(facetField in facetIndex)) facetIndex[facetField] = {};
    }

    return new LyraBundle<TItem>(items, manifest, facetIndex, nullIndex);
  }

  // ---- Private helpers ----

  /**
   * Compute candidate indices from `equal` filters.
   *
   * Empty filters → all indices. Any field not in the facet index → no matches.
   * Intersects posting lists in order of increasing size.
   *
   * @internal
   */
  private getEqualCandidates(equalFilters: Record<string, Scalar | Scalar[]>): number[] {
    const fields = Object.keys(equalFilters);
    if (fields.length === 0) return this.allIndices;

    interface FacetEntry { postings: number[]; size: number }
    const entries: FacetEntry[] = [];

    for (const field of fields) {
      const byValue = this.facetIndex[field];
      if (!byValue) return []; // Unknown facet field.

      const value = equalFilters[field];
      const values = Array.isArray(value) ? value : [value];

      // Empty IN clause → no matches.
      if (values.length === 0) return [];

      if (values.length === 1) {
        const postings = byValue[String(values[0])];
        if (!postings || postings.length === 0) return [];
        entries.push({ postings, size: postings.length });
        continue;
      }

      const postingsArrays: number[][] = [];
      for (const value of values) {
        const postings = byValue[String(value)];
        if (postings && postings.length > 0) postingsArrays.push(postings);
      }
      if (postingsArrays.length === 0) return [];

      const merged = arrayOps.mergeUnionSorted(postingsArrays);
      entries.push({ postings: merged, size: merged.length });
    }

    // Intersect smallest-first.
    entries.sort((entryA, entryB) => entryA.size - entryB.size);
    if (entries.length === 1) return entries[0].postings;

    // Double-buffered intersection using scratchEqual.
    const tmp: number[] = [];
    let current = entries[0].postings;
    for (let i = 1; i < entries.length; i++) {
      arrayOps.intersectSorted(current, entries[i].postings, tmp);
      this.scratchEqual.length = 0;
      for (let j = 0; j < tmp.length; j++) this.scratchEqual.push(tmp[j]);
      current = this.scratchEqual.slice();
      if (current.length === 0) return [];
    }
    return current;
  }

  /**
   * Build field type map for range fields.
   * @internal
   */
  private buildRangeFieldTypes(rangeFields: string[]): Record<string, FieldType> {
    const fieldTypes: Record<string, FieldType> = {};
    for (const field of rangeFields) {
      const def = this.manifest.fields.find((fieldDef) => fieldDef.name === field);
      if (def) fieldTypes[field] = def.type;
    }
    return fieldTypes;
  }

  /**
   * Compute facet counts over a set of candidate indices (canonical facets only).
   * @internal
   */
  private computeFacetCounts(indices: number[], facetFields: string[]): FacetCounts {
    const counts: FacetCounts = {};
    for (const field of facetFields) counts[field] = {};

    for (const idx of indices) {
      const item = this.items[idx] as Record<string, unknown>;
      for (const field of facetFields) {
        const raw = item[field];
        if (raw === undefined || raw === null) continue;
        const bucket = counts[field];
        if (Array.isArray(raw)) {
          for (const value of raw) {
            const key = String(value);
            bucket[key] = (bucket[key] ?? 0) + 1;
          }
        }
        else {
          const key = String(raw);
          bucket[key] = (bucket[key] ?? 0) + 1;
        }
      }
    }
    return counts;
  }

  /**
   * Build an empty result preserving the applied filter view.
   * @internal
   */
  private emptyResult(query: LyraQuery): LyraResult<T> {
    return {
      items: [],
      total: 0,
      applied: {
        equal: query.equal,
        notEqual: query.notEqual,
        ranges: query.ranges,
        isNull: query.isNull,
        isNotNull: query.isNotNull,
      },
      facets: undefined,
      snapshot: this.snapshot(),
    };
  }
}

// Re-export version constant (used by tests and external validators).
export { BUNDLE_VERSION };

// Utilities
// ==============================

/**
 * Parse a facet key string back to its typed value based on field type.
 * Used by `getFacetSummary` to convert string keys back to typed values.
 * @internal
 */
function parseFacetKey(fieldType: FieldType, key: string): string | number | boolean {
  switch (fieldType) {
    case 'number':
      return Number(key);
    case 'boolean':
      return key === 'true';
    case 'date': {
      const parsed = Date.parse(key);
      return Number.isNaN(parsed) ? key : parsed;
    }
    default:
      return key;
  }
}

