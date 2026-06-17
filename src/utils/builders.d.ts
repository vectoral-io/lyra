import type { CreateBundleConfig, InMemoryFacetIndex, InMemoryNullIndex, LookupTable, LyraManifest, RangeColumns } from '../types';
import type { ItemStore } from './item-store';
/**
 * Current bundle format version. v4.1 introduces columnar items inside the v4
 * binary container (dictionary-encoded strings, raw f64 numbers, packed bits
 * for booleans, JSON fallback for arrays/objects). v3.x JSON remains readable
 * indefinitely for portability and debugging.
 */
export declare const BUNDLE_VERSION = "4.1.0";
/**
 * Build a manifest from bundle configuration.
 * @internal
 */
export declare function buildManifest<TItem extends Record<string, unknown>>(config: CreateBundleConfig<TItem>): LyraManifest;
/**
 * Validate a manifest's internal consistency. Shared between build and load paths.
 *
 * Callers that construct manifests with invariants already guaranteed (e.g.
 * `buildManifest`) can skip this, but `load()` must call it on untrusted input.
 *
 * @internal
 */
export declare function validateManifest(manifest: LyraManifest): void;
/**
 * Build the in-memory facet index from items and manifest.
 *
 * Single-pass push with a tail-of-list dedup guard so each posting list comes
 * out strictly ascending without an explicit sort. Items are visited in
 * ascending index order; the only way a duplicate can appear in a bucket is
 * when one item lists the same value twice in an array-valued facet (e.g.
 * `tags: ['a','a']`), which the tail check filters in O(1) per push.
 * @internal
 */
export declare function buildFacetIndex<T extends Record<string, unknown>>(items: T[], manifest: LyraManifest): InMemoryFacetIndex;
/**
 * Build a sorted posting list of indices where each indexable field is null/undefined.
 *
 * Covers facet, range, and alias fields — any field a user might reference in
 * `isNull`/`isNotNull` or in `equal: { field: [val, null] }`. Single-pass push
 * into `number[]`, converted to Uint32Array at the end. Already ascending
 * since items are visited in order.
 *
 * @internal
 */
export declare function buildNullIndex<T extends Record<string, unknown>>(items: T[], manifest: LyraManifest): InMemoryNullIndex;
/**
 * Build columnar Float64Array storage for range fields. One column per range
 * field, length = items.length. Entries are coerced once: numbers passthrough,
 * date strings via `Date.parse`, anything else → NaN. Range filtering then
 * reads numeric columns directly, no per-query property access or parsing.
 * @internal
 */
export declare function buildRangeColumns<T extends Record<string, unknown>>(source: T[] | ItemStore<T>, manifest: LyraManifest): RangeColumns;
/**
 * Auto-generate alias lookup tables by scanning items for alias/target pairs.
 * @internal
 */
export declare function buildLookupTablesFromData<T>(items: T[], aliases: Record<string, string>): Record<string, LookupTable>;
//# sourceMappingURL=builders.d.ts.map