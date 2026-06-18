import type { RangeBound, Scalar } from '../types';
import type { SortedSource } from '../utils/array-operations';
import * as arrayOps from '../utils/array-operations';
import type { ItemStore } from '../utils/item-store';

/**
 * No-op filter passthrough: copy `indices[0..len)` into `target` unless they're
 * already the same buffer. Shared by the empty-filter early return in each
 * filter stage. Returns `len`.
 * @internal
 */
function copyThrough(indices: SortedSource, len: number, target: Uint32Array): number {
  if (target !== indices) {
    for (let i = 0; i < len; i++) target[i] = indices[i];
  }
  return len;
}

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
export function filterByNullChecks<T extends Record<string, unknown>>(
  indices: SortedSource,
  indicesLen: number,
  itemStore: ItemStore<T>,
  nullChecks: { isNull: string[]; isNotNull: string[] },
  nullIndex: Record<string, Uint32Array>,
  bufA: Uint32Array,
  bufB: Uint32Array,
  target: Uint32Array,
): number {
  if (nullChecks.isNull.length === 0 && nullChecks.isNotNull.length === 0) {
    return copyThrough(indices, indicesLen, target);
  }

  const allIndexed =
    nullChecks.isNull.every((field) => nullIndex[field] !== undefined) &&
    nullChecks.isNotNull.every((field) => nullIndex[field] !== undefined);

  if (allIndexed) {
    let current: Uint32Array = bufA;
    let next: Uint32Array = bufB;
    let currentLen = indicesLen;
    for (let i = 0; i < indicesLen; i++) current[i] = indices[i];

    for (const field of nullChecks.isNull) {
      const writtenLen = arrayOps.intersectSorted(
        current.subarray(0, currentLen),
        nullIndex[field],
        next,
      );
      if (writtenLen === 0) return 0;
      const tmp = current; current = next; next = tmp;
      currentLen = writtenLen;
    }

    for (const field of nullChecks.isNotNull) {
      const writtenLen = differenceSorted(
        current,
        currentLen,
        nullIndex[field],
        next,
      );
      if (writtenLen === 0) return 0;
      const tmp = current; current = next; next = tmp;
      currentLen = writtenLen;
    }

    if (target !== current) {
      for (let i = 0; i < currentLen; i++) target[i] = current[i];
    }
    return currentLen;
  }

  // Fallback linear scan.
  let writeIndex = 0;
  for (let i = 0; i < indicesLen; i++) {
    const idx = indices[i];
    let ok = true;

    for (const field of nullChecks.isNull) {
      const value = itemStore.getField(idx, field);
      if (value !== null && value !== undefined) {
        ok = false; break;
      }
    }
    if (!ok) continue;

    for (const field of nullChecks.isNotNull) {
      const value = itemStore.getField(idx, field);
      if (value === null || value === undefined) {
        ok = false; break;
      }
    }
    if (ok) target[writeIndex++] = idx;
  }
  return writeIndex;
}

/**
 * Exclude items whose value in any `excludes` field matches.
 *
 * notEqual applies only to non-null item values (null-handling goes through
 * isNull/isNotNull). Writes to `target`, returns number written.
 *
 * @internal
 */
export function filterByExclusions<T extends Record<string, unknown>>(
  indices: SortedSource,
  indicesLen: number,
  itemStore: ItemStore<T>,
  excludes: Record<string, Scalar | Scalar[]>,
  target: Uint32Array,
): number {
  const excludeFields = Object.keys(excludes);
  if (excludeFields.length === 0) {
    return copyThrough(indices, indicesLen, target);
  }

  // Hoist value-array shape outside the inner loop.
  const fieldValues: { field: string; values: Scalar[] }[] = excludeFields.map((field) => {
    const value = excludes[field];
    return { field, values: Array.isArray(value) ? value : [value] };
  });

  let writeIndex = 0;
  for (let i = 0; i < indicesLen; i++) {
    const idx = indices[i];
    let excluded = false;

    for (const { field, values } of fieldValues) {
      const itemValue = itemStore.getField(idx, field);
      if (itemValue === null || itemValue === undefined) continue;
      if (values.includes(itemValue as Scalar)) {
        excluded = true; break;
      }
    }

    if (!excluded) target[writeIndex++] = idx;
  }
  return writeIndex;
}

/**
 * Filter `indices[0..indicesLen)` to those satisfying every range bound.
 *
 * Range fields are read from precomputed `Float64Array` columns (one entry per
 * item; `NaN` means missing or unparsable, which fails any numeric comparison
 * and is therefore excluded). Writes kept indices to `target`; returns count.
 *
 * @internal
 */
export function filterByRanges(
  indices: SortedSource,
  indicesLen: number,
  ranges: Record<string, RangeBound>,
  rangeColumns: Record<string, Float64Array>,
  target: Uint32Array,
): number {
  const rangeFields = Object.keys(ranges);
  if (rangeFields.length === 0) {
    return copyThrough(indices, indicesLen, target);
  }

  // Hoist (column, min, max) tuples so the inner loop has no per-row Object lookup cost.
  // NaN bounds are treated as "no bound" to preserve prior semantics where
  // `min < NaN` / `max > NaN` always evaluated false and didn't exclude items.
  const tuples = rangeFields.map((field) => {
    const range = ranges[field];
    const min = range.min == null || Number.isNaN(range.min) ? -Infinity : range.min;
    const max = range.max == null || Number.isNaN(range.max) ? Infinity : range.max;
    return { col: rangeColumns[field], min, max };
  });

  let writeIndex = 0;
  for (let i = 0; i < indicesLen; i++) {
    const idx = indices[i];
    let passes = true;

    for (const tuple of tuples) {
      const value = tuple.col[idx];
      if (!(value >= tuple.min) || !(value <= tuple.max)) {
        passes = false;
        break;
      }
    }

    if (passes) target[writeIndex++] = idx;
  }

  return writeIndex;
}

/**
 * Sorted set difference: elements of `listA[0..lenA)` not present in `listB`.
 * Writes to `target`; returns count written.
 * @internal
 */
function differenceSorted(
  listA: SortedSource,
  lenA: number,
  listB: SortedSource,
  target: Uint32Array,
): number {
  let writeIndex = 0;
  let i = 0;
  let j = 0;
  const lenB = listB.length;
  while (i < lenA && j < lenB) {
    const av = listA[i];
    const bv = listB[j];
    if (av < bv) {
      target[writeIndex++] = av; i++;
    }
    else if (av > bv) {
      j++;
    }
    else {
      i++; j++;
    }
  }
  while (i < lenA) {
    target[writeIndex++] = listA[i]; i++;
  }
  return writeIndex;
}
