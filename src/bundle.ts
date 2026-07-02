import type {
  AnyBundleConfig,
  CreateBundleConfig,
  InMemoryFacetIndex,
  InMemoryNullIndex,
  LyraBundleJSON,
  LyraManifest,
  LyraQuery,
  LyraResult,
  LyraSnapshotInfo,
  RangeColumns,
  SimpleBundleConfig,
} from './types';
import { enrichItems, getAliasValues } from './aliases';
import { filterByExclusions, filterByNullChecks, filterByRanges } from './query/filters';
import { normalizeQuery, type NormalizedQuery, resolveAliases } from './query/normalize';
import { decodeFacetKey } from './query/facet-key';
import * as arrayOps from './utils/array-operations';
import { viewOf, type SortedSource } from './utils/array-operations';
import { computeFacetCounts, selectEqualCandidates } from './query/candidates';
import {
  BUNDLE_VERSION,
  buildFacetIndex,
  buildLookupTablesFromData,
  buildManifest,
  buildNullIndex,
  buildRangeColumns,
  validateDecodedBundle,
} from './utils/builders';
import { decodeV4, encodeV4, isV4Bundle } from './utils/binary-bundle';
import { decodeJSON, encodeJSON } from './utils/json-bundle';
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


/** Query-pipeline scratch buffers: equal candidates, per-stage outputs, and two workspaces. */
type ScratchKey = 'equal' | 'range' | 'null' | 'excl' | 'workA' | 'workB';

/**
 * Immutable bundle of items plus a manifest that describes fields and capabilities.
 */
export class LyraBundle<T extends Record<string, unknown>> {
  // Heavy structures are held in nullable backing fields so `dispose()` can
  // release them even while the bundle object itself is still referenced.
  // Accessed through the getters below, which throw once disposed.
  private _itemStore: ItemStore<T> | null;
  private readonly manifest: LyraManifest;
  private _facetIndex: InMemoryFacetIndex | null;
  private _nullIndex: InMemoryNullIndex | null;
  // Lazily built on first range-using query — building Float64Array columns
  // (especially date columns via Date.parse per item) is expensive, so we
  // defer it from bundle creation and pay it once on first use.
  private cachedRangeColumns: RangeColumns | null = null;

  // Cached [0..itemStore.length) for empty-query fast path. Lazily filled on demand.
  private cachedAllIndices: Uint32Array | null = null;

  // Set of declared field names, for the unknown-field query check. Derived
  // from the manifest (which outlives dispose), so it needs no reset.
  private cachedFieldNames: Set<string> | null = null;

  // Per-stage and workspace scratch buffers, each sized to itemStore.length and
  // lazily allocated on first use (see `buf`) so bundle creation pays only for
  // what users query.
  private scratch: Partial<Record<ScratchKey, Uint32Array>> = {};

  private constructor(
    itemStore: ItemStore<T>,
    manifest: LyraManifest,
    facetIndex: InMemoryFacetIndex,
    nullIndex: InMemoryNullIndex,
    preloadedRangeColumns: RangeColumns | null = null,
  ) {
    this._itemStore = itemStore;
    this.manifest = manifest;
    this._facetIndex = facetIndex;
    this._nullIndex = nullIndex;
    this.cachedRangeColumns = preloadedRangeColumns;
  }

  private get itemStore(): ItemStore<T> {
    if (!this._itemStore) throw new Error('Cannot use a disposed LyraBundle');
    return this._itemStore;
  }
  private get facetIndex(): InMemoryFacetIndex {
    if (!this._facetIndex) throw new Error('Cannot use a disposed LyraBundle');
    return this._facetIndex;
  }
  private get nullIndex(): InMemoryNullIndex {
    if (!this._nullIndex) throw new Error('Cannot use a disposed LyraBundle');
    return this._nullIndex;
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
  /** Lazily allocate (and memoize) a scratch buffer sized to the item count. */
  private buf(key: ScratchKey): Uint32Array {
    return (this.scratch[key] ??= new Uint32Array(this.itemStore.length));
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
    // Unknown-field contract (uniform across operators): if any operator
    // references a field the manifest doesn't declare, the query matches
    // nothing. Enforced in one place so notEqual/isNull can't silently fail
    // open on a typo the way equal/ranges already fail closed.
    if (this.referencesUnknownField(normalized)) return this.emptyResult(query);
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
    const equalResult = selectEqualCandidates(
      resolvedEqual,
      this.facetIndex,
      this.allIndices,
      this.itemStore.length,
      this.buf('equal'),
      this.buf('workA'),
      this.buf('workB'),
    );
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
        candidatesLen = arrayOps.mergeUnionSorted(inputs, this.buf('workA'));
        candidates = this.buf('workA');
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
        this.buf('range'),
      );
      candidates = this.buf('range');
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
        this.buf('workA'),
        this.buf('workB'),
        this.buf('null'),
      );
      candidates = this.buf('null');
    }

    // 5. Exclusions.
    if (Object.keys(resolvedNotEqual).length > 0) {
      candidatesLen = filterByExclusions(
        candidates,
        candidatesLen,
        this.itemStore,
        resolvedNotEqual,
        this.buf('excl'),
      );
      candidates = this.buf('excl');
    }

    // 6. Facet counts (canonical facets only).
    const total = candidatesLen;
    const facets = query.includeFacetCounts
      ? computeFacetCounts(this.itemStore, candidates, candidatesLen, this.manifest.capabilities.facets)
      : undefined;

    // 7. Pagination.
    const start = Math.max(0, query.offset ?? 0);
    const limit = query.limit != null ? Math.max(0, query.limit) : candidatesLen;
    const end = Math.min(candidatesLen, start + limit);
    const pageLen = end > start ? end - start : 0;
    let resultItems: T[] = this.itemStore.materializeMany(candidates, start, pageLen, query.select);

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
      applied: this.appliedView(query),
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
      values.push({ value: decodeFacetKey(fieldDef.type, key), count });
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
   * Whether this bundle has been disposed.
   */
  get isDisposed(): boolean {
    return this._itemStore === null;
  }

  /**
   * Release every heavy structure this bundle holds — item columns, facet and
   * null posting lists, range columns, and the query scratch buffers — so they
   * can be garbage-collected even if the bundle object itself is still
   * referenced (e.g. captured in a long-lived cache or component closure).
   *
   * Idempotent. After disposal, metadata methods (`describe`, `snapshot`,
   * `isDisposed`) keep working, but any data operation (`query`,
   * `getFacetSummary`, `toJSON`, `serialize`) throws.
   */
  dispose(): void {
    this._itemStore = null;
    this._facetIndex = null;
    this._nullIndex = null;
    this.cachedRangeColumns = null;
    this.cachedAllIndices = null;
    this.scratch = {};
  }

  /**
   * Serialize the bundle to a plain JSON-compatible structure.
   *
   * Emits the v3.0 legacy fields (`facetIndex`, `nullIndex` as `number[]`) for
   * back-compat, plus the v3.1 binary fields (`rangeColumns`, `facetIndexBin`,
   * `nullIndexBin`) which loaders prefer for faster, smaller hydration.
   *
   * Format encode/decode lives in `utils/json-bundle.ts`; this just supplies the
   * in-memory structures (materializing range columns so they ride on the wire).
   */
  toJSON(): LyraBundleJSON<T> {
    return encodeJSON<T>({
      manifest: this.manifest,
      items: this.itemStore.materializeAll(),
      facetIndex: this.facetIndex,
      nullIndex: this.nullIndex,
      rangeColumns: this.rangeColumns,
    });
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

    const decoded = decodeJSON<TItem>(raw);
    validateDecodedBundle(decoded.manifest, decoded.items.length, decoded.facetIndex, decoded.nullIndex);

    return new LyraBundle<TItem>(
      new RowItemStore(decoded.items),
      decoded.manifest,
      decoded.facetIndex,
      decoded.nullIndex,
      decoded.rangeColumns,
    );
  }

  /**
   * Load a bundle from a v4 binary buffer. Autodetected by `load(...)` when
   * passed a `Uint8Array`; expose explicitly for callers that prefer the
   * direct path.
   *
   * Validation (manifest consistency, facet allow-list, and posting bounds
   * against the item count) runs through the shared `validateDecodedBundle`, so
   * the JSON and binary paths reject hostile input by the same rules.
   */
  static loadBinary<TItem extends Record<string, unknown>>(
    bytes: Uint8Array,
  ): LyraBundle<TItem> {
    if (!isV4Bundle(bytes)) {
      throw new Error('Invalid bundle: expected v4 binary buffer (magic "LYRA4")');
    }
    const decoded = decodeV4<TItem>(bytes);
    const itemCount = decoded.items.kind === 'rows' ? decoded.items.rows.length : decoded.items.length;
    validateDecodedBundle(decoded.manifest, itemCount, decoded.facetIndex, decoded.nullIndex);

    const itemStore: ItemStore<TItem> = decoded.items.kind === 'rows'
      ? new RowItemStore<TItem>(decoded.items.rows)
      : ColumnarItemStore.lazy<TItem>(
        decoded.items.loadColumn,
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
    const store = this.itemStore;
    if (store instanceof ColumnarItemStore) {
      return {
        kind: 'columnar',
        loadColumn: (field) => store.getColumn(field),
        fieldNames: store.fieldNames,
        length: store.length,
      };
    }
    return { kind: 'rows', rows: store.materializeAll() };
  }

  // ---- Private helpers ----

  /**
   * True if any operator in the normalized query names a field the manifest
   * doesn't declare. Such a query matches nothing (fail closed).
   * @internal
   */
  private referencesUnknownField(normalized: NormalizedQuery): boolean {
    const known = (this.cachedFieldNames ??= new Set(this.manifest.fields.map((fld) => fld.name)));
    for (const field of Object.keys(normalized.equalFilters)) if (!known.has(field)) return true;
    for (const field of Object.keys(normalized.notEqualFilters)) if (!known.has(field)) return true;
    for (const field of Object.keys(normalized.rangeFilters)) if (!known.has(field)) return true;
    for (const field of normalized.nullChecks.isNull) if (!known.has(field)) return true;
    for (const field of normalized.nullChecks.isNotNull) if (!known.has(field)) return true;
    return false;
  }

  /**
   * The filter view echoed back on a result. (Reflects the requested filters.)
   * @internal
   */
  private appliedView(query: LyraQuery): LyraResult<T>['applied'] {
    return {
      equal: query.equal,
      notEqual: query.notEqual,
      ranges: query.ranges,
      isNull: query.isNull,
      isNotNull: query.isNotNull,
    };
  }

  /**
   * Build an empty result preserving the applied filter view.
   * @internal
   */
  private emptyResult(query: LyraQuery): LyraResult<T> {
    return {
      items: [],
      total: 0,
      applied: this.appliedView(query),
      facets: undefined,
      snapshot: this.snapshot(),
    };
  }
}

// Re-export version constant (used by tests and external validators).
export { BUNDLE_VERSION };


