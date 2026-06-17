import type { RangeBound, Scalar } from '../types';
import type { SortedSource } from '../utils/array-operations';
import type { ItemStore } from '../utils/item-store';
/**
 * Filter `indices[0..indicesLen)` by null/not-null constraints, writing kept
 * indices into `target`. Returns number of values written.
 *
 * Uses precomputed null posting lists when available to stay in the
 * posting-list asymptotic model; falls back to a linear scan otherwise.
 *
 * `bufA` and `bufB` are double-buffer scratches sized ≥ items.length, owned by
 * the caller. They get clobbered. `target` may be the same physical buffer as
 * one of them so long as the caller doesn't need its prior contents.
 *
 * @internal
 */
export declare function filterByNullChecks<T extends Record<string, unknown>>(indices: SortedSource, indicesLen: number, itemStore: ItemStore<T>, nullChecks: {
    isNull: string[];
    isNotNull: string[];
}, nullIndex: Record<string, Uint32Array>, bufA: Uint32Array, bufB: Uint32Array, target: Uint32Array): number;
/**
 * Exclude items whose value in any `excludes` field matches.
 *
 * notEqual applies only to non-null item values (null-handling goes through
 * isNull/isNotNull). Writes to `target`, returns number written.
 *
 * @internal
 */
export declare function filterByExclusions<T extends Record<string, unknown>>(indices: SortedSource, indicesLen: number, itemStore: ItemStore<T>, excludes: Record<string, Scalar | Scalar[]>, target: Uint32Array): number;
/**
 * Filter `indices[0..indicesLen)` to those satisfying every range bound.
 *
 * Range fields are read from precomputed `Float64Array` columns (one entry per
 * item; `NaN` means missing or unparsable, which fails any numeric comparison
 * and is therefore excluded). Writes kept indices to `target`; returns count.
 *
 * @internal
 */
export declare function filterByRanges(indices: SortedSource, indicesLen: number, ranges: Record<string, RangeBound>, rangeColumns: Record<string, Float64Array>, target: Uint32Array): number;
//# sourceMappingURL=filters.d.ts.map