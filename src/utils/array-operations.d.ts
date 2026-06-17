/**
 * Read-only sorted-ascending sequence of unique item indices.
 * Sources may be Uint32Array (in-memory posting lists, scratch buffers) or number[]
 * (legacy callers). Index access via `[i]` and `.length` is all that's required.
 */
export type SortedSource = ArrayLike<number>;
/**
 * Merge K sorted, deduplicated `SortedSource`s into `target` and return the
 * number of values written. Caller must size `target` to at least the sum of
 * source lengths to guarantee no overflow.
 *
 * Strategy:
 *  - K = 0/1/2: direct fast path.
 *  - K ≥ 3: pairwise bottom-up reduction (`O(N log K)` total work) — merge
 *    pairs into staging buffers each round until two lists remain, then merge
 *    those into `target`. Allocates K−1 small typed arrays per call but each
 *    inner merge stays in the cheap two-pointer fast path.
 */
export declare function mergeUnionSorted(arrays: SortedSource[], target: Uint32Array): number;
export declare function intersectSorted(listA: SortedSource, listB: SortedSource, target: Uint32Array): number;
//# sourceMappingURL=array-operations.d.ts.map