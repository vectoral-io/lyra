import type { FieldType, RangeBound, Scalar } from '../types';
import * as arrayOps from '../utils/array-operations';

/**
 * Filter indices by null/not-null constraints.
 *
 * Uses precomputed null posting lists when available to stay in the posting-list
 * asymptotic model; falls back to a linear scan for fields without an index entry.
 *
 * Writes the result to `scratch` (clearing it first) and returns the same reference.
 *
 * @internal
 */
export function filterByNullChecks<T>(
  indices: number[],
  items: T[],
  nullChecks: { isNull: string[]; isNotNull: string[] },
  nullIndex: Record<string, number[]>,
  scratch: number[],
): number[] {
  if (nullChecks.isNull.length === 0 && nullChecks.isNotNull.length === 0) {
    return indices;
  }

  // Fast path: every required field has a null posting list → reduce via intersect/difference.
  const allIndexed =
    nullChecks.isNull.every((field) => nullIndex[field] !== undefined) &&
    nullChecks.isNotNull.every((field) => nullIndex[field] !== undefined);

  if (allIndexed) {
    // Double-buffered reduction across fields.
    let current = indices.slice();
    const tmp: number[] = [];

    for (const field of nullChecks.isNull) {
      arrayOps.intersectSorted(current, nullIndex[field], tmp);
      if (tmp.length === 0) {
        scratch.length = 0; return scratch; 
      }
      current = tmp.slice();
    }

    for (const field of nullChecks.isNotNull) {
      differenceSorted(current, nullIndex[field], tmp);
      if (tmp.length === 0) {
        scratch.length = 0; return scratch; 
      }
      current = tmp.slice();
    }

    scratch.length = 0;
    for (let i = 0; i < current.length; i++) scratch.push(current[i]);
    return scratch;
  }

  // Fallback: linear scan over `items` for fields not covered by nullIndex.
  scratch.length = 0;
  for (const idx of indices) {
    const item = items[idx] as Record<string, unknown>;
    let ok = true;

    for (const field of nullChecks.isNull) {
      const value = item[field];
      if (value !== null && value !== undefined) {
        ok = false; break;
      }
    }
    if (!ok) continue;

    for (const field of nullChecks.isNotNull) {
      const value = item[field];
      if (value === null || value === undefined) {
        ok = false; break;
      }
    }
    if (ok) scratch.push(idx);
  }
  return scratch;
}

/**
 * Exclude items whose value in any `excludes` field matches.
 *
 * notEqual applies only to non-null item values (null-handling goes through isNull/isNotNull).
 *
 * Writes to `scratch` and returns it.
 *
 * @internal
 */
export function filterByExclusions<T>(
  indices: number[],
  items: T[],
  excludes: Record<string, Scalar | Scalar[]>,
  scratch: number[],
): number[] {
  if (Object.keys(excludes).length === 0) return indices;
  if (indices === scratch) {
    throw new Error('filterByExclusions: indices and scratch must not alias');
  }

  scratch.length = 0;

  for (const idx of indices) {
    const item = items[idx] as Record<string, unknown>;
    let excluded = false;

    for (const [field, value] of Object.entries(excludes)) {
      const itemValue = item[field];
      if (itemValue === null || itemValue === undefined) continue;

      const values = Array.isArray(value) ? value : [value];
      if (values.includes(itemValue as Scalar)) {
        excluded = true; break; 
      }
    }

    if (!excluded) scratch.push(idx);
  }

  return scratch;
}

/**
 * Coerce a raw item value into a comparable numeric for range filtering.
 * Returns null for values that cannot be safely compared under the declared field type.
 * @internal
 */
function toNumericRangeValue(raw: unknown, fieldType: FieldType): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return raw;
  if (fieldType === 'date') {
    const parsed = Date.parse(String(raw));
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (fieldType === 'number') {
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Filter `indices` down to items that satisfy every range bound.
 * Writes to `scratch` and returns it.
 * @internal
 */
export function filterByRanges<T extends Record<string, unknown>>(
  indices: number[],
  items: T[],
  ranges: Record<string, RangeBound>,
  fieldTypes: Record<string, FieldType>,
  scratch: number[],
): number[] {
  if (Object.keys(ranges).length === 0) return indices;
  if (indices === scratch) {
    throw new Error('filterByRanges: indices and scratch must not alias');
  }

  scratch.length = 0;
  const rangeFields = Object.keys(ranges);

  for (const idx of indices) {
    const item = items[idx];
    let passes = true;

    for (const field of rangeFields) {
      const numeric = toNumericRangeValue(item[field], fieldTypes[field]);
      if (numeric === null) {
        passes = false; break; 
      }
      const { min, max } = ranges[field];
      if (min != null && numeric < min) {
        passes = false; break; 
      }
      if (max != null && numeric > max) {
        passes = false; break; 
      }
    }

    if (passes) scratch.push(idx);
  }

  return scratch;
}

/**
 * Sorted set difference: elements of `a` not present in `b`.
 * Both arrays must be sorted ascending; writes to `target`.
 * @internal
 */
function differenceSorted(listA: number[], listB: number[], target: number[]): void {
  target.length = 0;
  let i = 0;
  let j = 0;
  while (i < listA.length && j < listB.length) {
    const av = listA[i];
    const bv = listB[j];
    if (av < bv) {
      target.push(av); i++;
    }
    else if (av > bv) {
      j++;
    }
    else {
      i++; j++;
    }
  }
  while (i < listA.length) {
    target.push(listA[i]); i++;
  }
}
