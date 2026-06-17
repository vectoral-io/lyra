import type { CreateBundleConfig, LyraBundleJSON, LyraManifest, LyraQuery, LyraResult, LyraSnapshotInfo, SimpleBundleConfig } from './types';
import { BUNDLE_VERSION } from './utils/builders';
/**
 * Create a bundle from items.
 *
 * Overloads:
 * - Explicit config: full control over field kinds/types via `CreateBundleConfig`.
 * - Simple config: ergonomic `SimpleBundleConfig` that infers types from data.
 */
export declare function createBundle<T extends Record<string, unknown>>(items: T[], config: CreateBundleConfig<T>): Promise<LyraBundle<T>>;
export declare function createBundle<T extends Record<string, unknown>>(items: T[], config: SimpleBundleConfig<T>): Promise<LyraBundle<T>>;
/**
 * Immutable bundle of items plus a manifest that describes fields and capabilities.
 */
export declare class LyraBundle<T extends Record<string, unknown>> {
    private readonly itemStore;
    private readonly manifest;
    private readonly facetIndex;
    private readonly nullIndex;
    private cachedRangeColumns;
    private cachedAllIndices;
    private cachedBufEqual;
    private cachedBufRange;
    private cachedBufNull;
    private cachedBufExcl;
    private cachedBufWorkA;
    private cachedBufWorkB;
    private constructor();
    private get rangeColumns();
    private get allIndices();
    private get bufEqual();
    private get bufRange();
    private get bufNull();
    private get bufExcl();
    private get bufWorkA();
    private get bufWorkB();
    /**
     * Build a new bundle from raw items and bundle configuration.
     */
    static create<TItem extends Record<string, unknown>>(items: TItem[], config: CreateBundleConfig<TItem>): Promise<LyraBundle<TItem>>;
    /**
     * Execute a query against the bundle.
     *
     * Query contract:
     * - Unknown fields: treated as "no matches" (returns total = 0).
     * - Negative offset: clamped to 0.
     * - Negative limit: treated as 0 (no results).
     * - All operators are intersected (AND logic).
     */
    query(query?: LyraQuery): LyraResult<T>;
    /**
     * Get a summary of distinct values and counts for a facet field.
     *
     * Returns distinct values and their counts, optionally filtered by other facets or ranges.
     */
    getFacetSummary(field: string, options?: {
        equal?: LyraQuery['equal'];
        ranges?: LyraQuery['ranges'];
    }): {
        field: string;
        values: Array<{
            value: string | number | boolean;
            count: number;
        }>;
    };
    /**
     * Look up alias values for a single canonical ID.
     *
     * @example
     * ```ts
     * bundle.getAliasValues('zone_name', 'Z-001'); // ['Zone A']
     * ```
     */
    getAliasValues(aliasField: string, canonicalId: string | number): string[];
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
    enrichItems(items: T[], aliasFields: string[]): Array<T & Record<string, string[]>>;
    /**
     * Return the bundle manifest describing fields and capabilities.
     */
    describe(): LyraManifest;
    /**
     * Return the bundle snapshot metadata.
     */
    snapshot(): LyraSnapshotInfo;
    /**
     * Serialize the bundle to a plain JSON-compatible structure.
     *
     * Emits the v3.0 legacy fields (`facetIndex`, `nullIndex` as `number[]`) for
     * back-compat, plus the v3.1 binary fields (`rangeColumns`, `facetIndexBin`,
     * `nullIndexBin`) which loaders prefer for faster, smaller hydration.
     *
     *! NOTE: Any structural change here must be reflected in docs/bundle-json-spec.md
     */
    toJSON(): LyraBundleJSON<T>;
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
    static load<TItem extends Record<string, unknown>>(raw: LyraBundleJSON<TItem> | Uint8Array): LyraBundle<TItem>;
    /**
     * Load a bundle from a v4 binary buffer. Autodetected by `load(...)` when
     * passed a `Uint8Array`; expose explicitly for callers that prefer the
     * direct path.
     *
     * Validates the manifest and ensures every facet/null index field is
     * declared in `capabilities`; rejects unknown fields with a clear error.
     */
    static loadBinary<TItem extends Record<string, unknown>>(bytes: Uint8Array): LyraBundle<TItem>;
    /**
     * Build the items input expected by `encodeV4` from this bundle's storage.
     * `RowItemStore` passes its rows directly so the encoder can run dictionary
     * encoding once; `ColumnarItemStore` already has columns and we pass them
     * through verbatim.
     * @internal
     */
    private itemStoreAsV4Input;
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
    private getEqualCandidates;
    /**
     * Compute facet counts over a set of candidate indices (canonical facets only).
     * @internal
     */
    private computeFacetCounts;
    /**
     * Build an empty result preserving the applied filter view.
     * @internal
     */
    private emptyResult;
}
export { BUNDLE_VERSION };
//# sourceMappingURL=bundle.d.ts.map