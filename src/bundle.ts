import type {
  AnyBundleConfig,
  CreateBundleConfig,
  FacetCounts,
  FacetPostingLists,
  FacetPostingListsBin,
  FieldType,
  InMemoryFacetIndex,
  InMemoryNullIndex,
  LyraBundleJSON,
  LyraManifest,
  LyraQuery,
  LyraResult,
  LyraSnapshotInfo,
  NullPostingLists,
  NullPostingListsBin,
  RangeColumns,
  RangeColumnsJSON,
  Scalar,
  SimpleBundleConfig,
} from './types';
import { enrichItems, getAliasValues } from './aliases';
import { filterByExclusions, filterByNullChecks, filterByRanges } from './query/filters';
import { normalizeQuery, resolveAliases } from './query/normalize';
import * as arrayOps from './utils/array-operations';
import type { SortedSource } from './utils/array-operations';
import {
  BUNDLE_VERSION,
  buildFacetIndex,
  buildLookupTablesFromData,
  buildManifest,
  buildNullIndex,
  buildRangeColumns,
  validateManifest,
} from './utils/builders';
import { decodeV4, encodeV4, isV4Bundle } from './utils/binary-bundle';
import {
  b64ToF64Array,
  deltaVarintDecode,
  deltaVarintEncode,
  f64ArrayToB64,
} from './utils/codec';
import {
  ColumnarItemStore,
  type ItemStore,
  RowItemStore,
} from './utils/item-store';
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
  private readonly itemStore: ItemStore<T>;
  private readonly manifest: LyraManifest;
  private readonly facetIndex: InMemoryFacetIndex;
  private readonly nullIndex: InMemoryNullIndex;
  // Lazily built on first range-using query — building Float64Array columns
  // (especially date columns via Date.parse per item) is expensive, so we
  // defer it from bundle creation and pay it once on first use.
  private cachedRangeColumns: RangeColumns | null = null;

  // Cached [0..itemStore.length) for empty-query fast path. Lazily filled on demand.
  private cachedAllIndices: Uint32Array | null = null;

  // Per-stage and workspace scratch buffers, sized to itemStore.length. Lazily
  // allocated on first query so bundle creation pays only for what users use.
  private cachedBufEqual: Uint32Array | null = null;
  private cachedBufRange: Uint32Array | null = null;
  private cachedBufNull: Uint32Array | null = null;
  private cachedBufExcl: Uint32Array | null = null;
  private cachedBufWorkA: Uint32Array | null = null;
  private cachedBufWorkB: Uint32Array | null = null;

  private constructor(
    itemStore: ItemStore<T>,
    manifest: LyraManifest,
    facetIndex: InMemoryFacetIndex,
    nullIndex: InMemoryNullIndex,
    preloadedRangeColumns: RangeColumns | null = null,
  ) {
    this.itemStore = itemStore;
    this.manifest = manifest;
    this.facetIndex = facetIndex;
    this.nullIndex = nullIndex;
    this.cachedRangeColumns = preloadedRangeColumns;
  }

  private get rangeColumns(): RangeColumns {
    return this.cachedRangeColumns ??= buildRangeColumns(this.itemStore, this.manifest);
  }

  private get allIndices(): Uint32Array {
    if (!this.cachedAllIndices) {
      const itemCount = this.itemStore.length;
      const all = new Uint32Array(itemCount);
      for (let i = 0; i < itemCount; i++) all[i] = i;
      this.cachedAllIndices = all;
    }
    return this.cachedAllIndices;
  }
  private get bufEqual(): Uint32Array {
    return this.cachedBufEqual ??= new Uint32Array(this.itemStore.length);
  }
  private get bufRange(): Uint32Array {
    return this.cachedBufRange ??= new Uint32Array(this.itemStore.length);
  }
  private get bufNull(): Uint32Array {
    return this.cachedBufNull ??= new Uint32Array(this.itemStore.length);
  }
  private get bufExcl(): Uint32Array {
    return this.cachedBufExcl ??= new Uint32Array(this.itemStore.length);
  }
  private get bufWorkA(): Uint32Array {
    return this.cachedBufWorkA ??= new Uint32Array(this.itemStore.length);
  }
  private get bufWorkB(): Uint32Array {
    return this.cachedBufWorkB ??= new Uint32Array(this.itemStore.length);
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
    return new LyraBundle(new RowItemStore(items), finalManifest, facetIndex, nullIndex);
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
    const equalResult = this.getEqualCandidates(resolvedEqual);
    if (equalResult === null) return this.emptyResult(query);
    let candidates: SortedSource = equalResult.buf;
    let candidatesLen = equalResult.len;

    // 2. Union in null-matching indices for any `equal: { field: [val, null] }` fields.
    if (normalized.equalWithNull.size > 0) {
      const nullLists: SortedSource[] = [];
      for (const field of normalized.equalWithNull) {
        const nulls = this.nullIndex[field];
        if (nulls && nulls.length > 0) nullLists.push(nulls);
      }
      if (nullLists.length > 0) {
        // Use bufWorkA as merge target so we never alias `candidates` (which may be bufEqual).
        const inputs: SortedSource[] = [
          viewOf(candidates, candidatesLen),
          ...nullLists,
        ];
        candidatesLen = arrayOps.mergeUnionSorted(inputs, this.bufWorkA);
        candidates = this.bufWorkA;
      }
    }

    // 3. Range filters.
    if (Object.keys(normalized.rangeFilters).length > 0) {
      const rangeFields = Object.keys(normalized.rangeFilters);
      const validRanges = new Set(this.manifest.capabilities.ranges);
      if (rangeFields.some((field) => !validRanges.has(field))) {
        return this.emptyResult(query);
      }
      candidatesLen = filterByRanges(
        candidates,
        candidatesLen,
        normalized.rangeFilters,
        this.rangeColumns,
        this.bufRange,
      );
      candidates = this.bufRange;
    }

    // 4. Null checks (skip fields already covered by equalWithNull).
    const hasNullChecks =
      normalized.nullChecks.isNull.length > 0 || normalized.nullChecks.isNotNull.length > 0;
    if (hasNullChecks) {
      const explicitNullChecks = {
        isNull: normalized.nullChecks.isNull.filter((field) => !normalized.equalWithNull.has(field)),
        isNotNull: normalized.nullChecks.isNotNull,
      };
      candidatesLen = filterByNullChecks(
        candidates,
        candidatesLen,
        this.itemStore,
        explicitNullChecks,
        this.nullIndex,
        this.bufWorkA,
        this.bufWorkB,
        this.bufNull,
      );
      candidates = this.bufNull;
    }

    // 5. Exclusions.
    if (Object.keys(resolvedNotEqual).length > 0) {
      candidatesLen = filterByExclusions(
        candidates,
        candidatesLen,
        this.itemStore,
        resolvedNotEqual,
        this.bufExcl,
      );
      candidates = this.bufExcl;
    }

    // 6. Facet counts (canonical facets only).
    const total = candidatesLen;
    const facets = query.includeFacetCounts
      ? this.computeFacetCounts(candidates, candidatesLen, this.manifest.capabilities.facets)
      : undefined;

    // 7. Pagination.
    const start = Math.max(0, query.offset ?? 0);
    const limit = query.limit != null ? Math.max(0, query.limit) : candidatesLen;
    const end = Math.min(candidatesLen, start + limit);
    const pageLen = end > start ? end - start : 0;
    let resultItems: T[] = this.itemStore.materializeMany(candidates, start, pageLen);

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
   * Emits the v3.0 legacy fields (`facetIndex`, `nullIndex` as `number[]`) for
   * back-compat, plus the v3.1 binary fields (`rangeColumns`, `facetIndexBin`,
   * `nullIndexBin`) which loaders prefer for faster, smaller hydration.
   *
   *! NOTE: Any structural change here must be reflected in docs/bundle-json-spec.md
   */
  toJSON(): LyraBundleJSON<T> {
    const facetIndex: FacetPostingLists = {};
    const facetIndexBin: FacetPostingListsBin = {};
    for (const field in this.facetIndex) {
      const byValue = this.facetIndex[field];
      const legacy: Record<string, number[]> = {};
      const binary: Record<string, string> = {};
      for (const valueKey in byValue) {
        const postings = byValue[valueKey];
        legacy[valueKey] = Array.from(postings);
        binary[valueKey] = deltaVarintEncode(postings);
      }
      facetIndex[field] = legacy;
      facetIndexBin[field] = binary;
    }

    const nullIndex: NullPostingLists = {};
    const nullIndexBin: NullPostingListsBin = {};
    for (const field in this.nullIndex) {
      const postings = this.nullIndex[field];
      nullIndex[field] = Array.from(postings);
      nullIndexBin[field] = deltaVarintEncode(postings);
    }

    // Eagerly materialize range columns so they ride along on the wire and
    // reloaders skip the per-load Date.parse storm.
    const rangeColumnsMap = this.rangeColumns;
    const rangeColumns: RangeColumnsJSON = {};
    for (const field in rangeColumnsMap) {
      rangeColumns[field] = { encoding: 'b64f64', data: f64ArrayToB64(rangeColumnsMap[field]) };
    }

    return {
      manifest: this.manifest,
      items: this.itemStore.materializeAll(),
      facetIndex,
      nullIndex,
      rangeColumns,
      facetIndexBin,
      nullIndexBin,
    };
  }

  /**
   * Serialize the bundle. By default produces a JSON-compatible value (same as
   * `toJSON()`); pass `'binary'` to produce a v4 binary container.
   *
   * Binary bundles are typically 3–5× smaller on the wire and hydrate faster
   * (zero-copy range columns when alignment permits), at the cost of being
   * non-human-readable.
   */
  serialize(): LyraBundleJSON<T>;
  serialize(format: 'json'): LyraBundleJSON<T>;
  serialize(format: 'binary'): Uint8Array;
  serialize(format: 'json' | 'binary' = 'json'): LyraBundleJSON<T> | Uint8Array {
    if (format === 'binary') {
      return encodeV4<T>({
        manifest: this.manifest,
        items: this.itemStoreAsV4Input(),
        facetIndex: this.facetIndex,
        nullIndex: this.nullIndex,
        rangeColumns: this.rangeColumns,
      });
    }
    return this.toJSON();
  }

  /**
   * Load a bundle from a previously serialized JSON value or v4 binary buffer.
   *
   * For JSON input: prefers v3.1 binary-encoded fields (`facetIndexBin`,
   * `nullIndexBin`, `rangeColumns`) when present; falls back to legacy
   * `facetIndex` / `nullIndex` and rebuilds range columns from items.
   *
   * For `Uint8Array` input: autodetects v4 by magic bytes and dispatches to
   * `loadBinary`.
   *
   *! NOTE: Any structural change here must be reflected in docs/bundle-json-spec.md
   */
  static load<TItem extends Record<string, unknown>>(
    raw: LyraBundleJSON<TItem> | Uint8Array,
  ): LyraBundle<TItem> {
    if (raw instanceof Uint8Array) {
      return LyraBundle.loadBinary<TItem>(raw);
    }
    if (!raw || !raw.manifest || !raw.items) {
      throw new Error('Invalid bundle JSON: missing manifest or items');
    }

    const { manifest, items } = raw;
    validateManifest(manifest);

    const rawFacet: FacetPostingLists = raw.facetIndex ?? {};
    const rawNull: NullPostingLists = raw.nullIndex ?? {};
    const rawFacetBin = raw.facetIndexBin;
    const rawNullBin = raw.nullIndexBin;

    // Validate facet index — reject unknown fields in either legacy or binary block.
    const allFacetKeys = new Set<string>();
    for (const k of Object.keys(rawFacet)) allFacetKeys.add(k);
    if (rawFacetBin) for (const k of Object.keys(rawFacetBin)) allFacetKeys.add(k);
    for (const indexKey of allFacetKeys) {
      if (!manifest.capabilities.facets.includes(indexKey)) {
        throw new Error(
          `Invalid bundle: facetIndex contains field "${indexKey}" that is not in capabilities.facets`,
        );
      }
    }

    const facetIndex: InMemoryFacetIndex = {};
    for (const field of manifest.capabilities.facets) {
      const out: Record<string, Uint32Array> = {};
      const binByValue = rawFacetBin?.[field];
      if (binByValue) {
        for (const valueKey in binByValue) {
          out[valueKey] = deltaVarintDecode(binByValue[valueKey]);
        }
      }
      else {
        const byValue = rawFacet[field];
        if (byValue) {
          for (const valueKey in byValue) {
            out[valueKey] = numberArrayToUint32(byValue[valueKey]);
          }
        }
      }
      facetIndex[field] = out;
    }

    const nullIndex: InMemoryNullIndex = {};
    if (rawNullBin) {
      for (const field in rawNullBin) {
        nullIndex[field] = deltaVarintDecode(rawNullBin[field]);
      }
    }
    else {
      for (const field in rawNull) {
        nullIndex[field] = numberArrayToUint32(rawNull[field]);
      }
    }

    // Range columns: prefer pre-encoded block; otherwise leave null and let
    // the lazy getter rebuild from items on first range query (legacy path).
    let preloadedRangeColumns: RangeColumns | null = null;
    if (raw.rangeColumns) {
      preloadedRangeColumns = {};
      for (const field in raw.rangeColumns) {
        const block = raw.rangeColumns[field];
        if (block.encoding !== 'b64f64') {
          throw new Error(
            `Invalid bundle: rangeColumns["${field}"] has unsupported encoding "${block.encoding}"`,
          );
        }
        preloadedRangeColumns[field] = b64ToF64Array(block.data);
      }
    }

    return new LyraBundle<TItem>(
      new RowItemStore(items),
      manifest,
      facetIndex,
      nullIndex,
      preloadedRangeColumns,
    );
  }

  /**
   * Load a bundle from a v4 binary buffer. Autodetected by `load(...)` when
   * passed a `Uint8Array`; expose explicitly for callers that prefer the
   * direct path.
   *
   * Validates the manifest and ensures every facet/null index field is
   * declared in `capabilities`; rejects unknown fields with a clear error.
   */
  static loadBinary<TItem extends Record<string, unknown>>(
    bytes: Uint8Array,
  ): LyraBundle<TItem> {
    if (!isV4Bundle(bytes)) {
      throw new Error('Invalid bundle: expected v4 binary buffer (magic "LYRA4")');
    }
    const decoded = decodeV4<TItem>(bytes);
    validateManifest(decoded.manifest);

    for (const field of Object.keys(decoded.facetIndex)) {
      if (!decoded.manifest.capabilities.facets.includes(field)) {
        throw new Error(
          `Invalid bundle: facetIndex contains field "${field}" that is not in capabilities.facets`,
        );
      }
    }

    const itemStore: ItemStore<TItem> = decoded.items.kind === 'rows'
      ? new RowItemStore<TItem>(decoded.items.rows)
      : new ColumnarItemStore<TItem>(
        decoded.items.columns,
        decoded.items.fieldNames,
        decoded.items.length,
      );

    return new LyraBundle<TItem>(
      itemStore,
      decoded.manifest,
      decoded.facetIndex,
      decoded.nullIndex,
      decoded.rangeColumns,
    );
  }

  /**
   * Build the items input expected by `encodeV4` from this bundle's storage.
   * `RowItemStore` passes its rows directly so the encoder can run dictionary
   * encoding once; `ColumnarItemStore` already has columns and we pass them
   * through verbatim.
   * @internal
   */
  private itemStoreAsV4Input(): import('./utils/binary-bundle').V4ItemsInput<T> {
    if (this.itemStore instanceof ColumnarItemStore) {
      return {
        kind: 'columnar',
        columns: this.itemStore.columns,
        fieldNames: this.itemStore.fieldNames,
        length: this.itemStore.length,
      };
    }
    return { kind: 'rows', rows: this.itemStore.materializeAll() };
  }

  // ---- Private helpers ----

  /**
   * Compute candidate indices from `equal` filters.
   *
   * Empty filters → all indices. Any field not in the facet index → no matches.
   * Intersects posting lists in order of increasing size. Returns null on no-match.
   *
   * Result `buf` may be:
   * - this.allIndices (no filters)
   * - a posting list directly from the facet index (single field, single value)
   * - this.bufWorkA after a multi-value union (single field, multi value)
   * - this.bufEqual after K-way intersection (multi field)
   *
   * @internal
   */
  private getEqualCandidates(
    equalFilters: Record<string, Scalar | Scalar[]>,
  ): { buf: SortedSource; len: number } | null {
    const fields = Object.keys(equalFilters);
    if (fields.length === 0) return { buf: this.allIndices, len: this.itemStore.length };

    // Single-field fast path. Avoids per-query allocation: posting lists return
    // by reference, multi-value unions write directly into bufEqual.
    if (fields.length === 1) {
      const field = fields[0];
      const byValue = this.facetIndex[field];
      if (!byValue) return null;

      const value = equalFilters[field];
      const values = Array.isArray(value) ? value : [value];
      if (values.length === 0) return null;

      if (values.length === 1) {
        const postings = byValue[String(values[0])];
        if (!postings || postings.length === 0) return null;
        return { buf: postings, len: postings.length };
      }

      const postingsArrays: SortedSource[] = [];
      for (const candidateValue of values) {
        const postings = byValue[String(candidateValue)];
        if (postings && postings.length > 0) postingsArrays.push(postings);
      }
      if (postingsArrays.length === 0) return null;
      if (postingsArrays.length === 1) {
        return { buf: postingsArrays[0], len: postingsArrays[0].length };
      }

      const len = arrayOps.mergeUnionSorted(postingsArrays, this.bufEqual);
      return { buf: this.bufEqual, len };
    }

    // Multi-field path. Each field contributes a posting list (or per-field
    // union); we intersect smallest-first using bufWorkA/bufWorkB ping-pong
    // and land the final result in bufEqual.
    interface FacetEntry { postings: SortedSource; size: number }
    const entries: FacetEntry[] = [];

    for (const field of fields) {
      const byValue = this.facetIndex[field];
      if (!byValue) return null;

      const value = equalFilters[field];
      const values = Array.isArray(value) ? value : [value];
      if (values.length === 0) return null;

      if (values.length === 1) {
        const postings = byValue[String(values[0])];
        if (!postings || postings.length === 0) return null;
        entries.push({ postings, size: postings.length });
        continue;
      }

      const postingsArrays: SortedSource[] = [];
      for (const candidateValue of values) {
        const postings = byValue[String(candidateValue)];
        if (postings && postings.length > 0) postingsArrays.push(postings);
      }
      if (postingsArrays.length === 0) return null;

      // Per-field union must be held through the K-way intersection below, so
      // copy out of the shared workspace. Only the multi-field-multi-value case
      // pays this allocation; single-field multi-value is handled above.
      const len = arrayOps.mergeUnionSorted(postingsArrays, this.bufWorkA);
      entries.push({ postings: this.bufWorkA.slice(0, len), size: len });
    }

    entries.sort((entryA, entryB) => entryA.size - entryB.size);

    let current: SortedSource = entries[0].postings;
    let currentLen = entries[0].size;
    let workTarget: Uint32Array = this.bufWorkA;
    let workOther: Uint32Array = this.bufWorkB;
    for (let i = 1; i < entries.length; i++) {
      const finalRound = i === entries.length - 1;
      const target = finalRound ? this.bufEqual : workTarget;
      const written = arrayOps.intersectSorted(
        viewOf(current, currentLen),
        entries[i].postings,
        target,
      );
      if (written === 0) return null;
      current = target;
      currentLen = written;
      if (!finalRound) {
        const swap = workTarget; workTarget = workOther; workOther = swap;
      }
    }
    return { buf: this.bufEqual, len: currentLen };
  }

  /**
   * Compute facet counts over a set of candidate indices (canonical facets only).
   * @internal
   */
  private computeFacetCounts(
    indices: SortedSource,
    indicesLen: number,
    facetFields: string[],
  ): FacetCounts {
    const counts: FacetCounts = {};
    for (const field of facetFields) counts[field] = {};

    for (let i = 0; i < indicesLen; i++) {
      const idx = indices[i];
      for (const field of facetFields) {
        const raw = this.itemStore.getField(idx, field);
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
 * Return a read-only view of the first `len` elements of `source`. For
 * `Uint32Array` sources we use `subarray` (zero-copy view); other shapes (the
 * cached `allIndices`) are passed through unchanged when len matches.
 * @internal
 */
function viewOf(source: SortedSource, len: number): SortedSource {
  if (source instanceof Uint32Array) {
    return source.length === len ? source : source.subarray(0, len);
  }
  return source;
}

/**
 * Pre-allocated copy from a plain `number[]` to a `Uint32Array`. Faster than
 * `Uint32Array.from(arr)` because it avoids the iterator protocol and the
 * intermediate spec-mandated growth path; one allocation, one tight loop.
 * @internal
 */
function numberArrayToUint32(source: number[]): Uint32Array {
  const out = new Uint32Array(source.length);
  for (let i = 0; i < source.length; i++) out[i] = source[i];
  return out;
}

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

