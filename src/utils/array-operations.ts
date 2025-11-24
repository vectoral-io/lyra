import type { RangeFilter } from '../types';

// Utils
// ==============================

/**
 * Merge multiple sorted arrays into a single sorted, deduplicated array.
 * Uses two-pointer merge approach for efficiency.
 */
export function mergeUnionSorted(arrays: number[][]): number[] {
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
export function intersectSorted(
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


/**
 * Filter indices array by range conditions, checking items at those indices.
 * Returns a new array of indices that pass all range filters.
 * 
 * Range semantics:
 * - Range `min` and `max` values must be numbers
 * - For date fields, pass epoch milliseconds (e.g., `Date.parse(isoString)`)
 * - Items are included if their value is >= `min` (if provided) and <= `max` (if provided)
 */
export function filterIndicesByRange<T extends Record<string, unknown>>(
  indices: number[],
  items: T[],
  ranges: Record<string, RangeFilter>,
): number[] {
  const result: number[] = [];

  for (const idx of indices) {
    const item = items[idx];
    let passes = true;

    for (const [field, range] of Object.entries(ranges)) {
      const rawValue = (item as Record<string, unknown>)[field];
      if (rawValue == null) {
        passes = false;
        break;
      }

      const numericValue =
        typeof rawValue === 'number'
          ? rawValue
          : Date.parse(String(rawValue)) || NaN;

      if (Number.isNaN(numericValue)) {
        passes = false;
        break;
      }
      if (range.min != null && numericValue < range.min) {
        passes = false;
        break;
      }
      if (range.max != null && numericValue > range.max) {
        passes = false;
        break;
      }
    }

    if (passes) {
      result.push(idx);
    }
  }

  return result;
}

