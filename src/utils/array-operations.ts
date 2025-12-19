import type { FieldType, RangeBound } from '../types';

const TWO_ARRAYS = 2;

/**
 * Merge multiple sorted arrays into a single sorted, deduplicated array.
 * Uses two-pointer merge approach for efficiency.
 * Optimized for small K (0, 1, 2 arrays).
 */
export function mergeUnionSorted(arrays: number[][]): number[] {
  // Fast path for empty input
  if (arrays.length === 0) return [];
  
  // Fast path for single array
  if (arrays.length === 1) return arrays[0];
  
  // Fast path for two arrays (common case)
  if (arrays.length === TWO_ARRAYS) {
    return mergeUnionTwoSorted(arrays[0], arrays[1]);
  }

  // General case: K > 2
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
 * Merge two sorted arrays into a single sorted, deduplicated array.
 * Optimized 2-way merge for common case.
 * @internal
 */
function mergeUnionTwoSorted(listA: number[], listB: number[]): number[] {
  const result: number[] = [];
  let pointerA = 0;
  let pointerB = 0;

  while (pointerA < listA.length && pointerB < listB.length) {
    const valueA = listA[pointerA];
    const valueB = listB[pointerB];

    if (valueA < valueB) {
      if (result.length === 0 || result[result.length - 1] !== valueA) {
        result.push(valueA);
      }
      pointerA++;
    }
    else if (valueA > valueB) {
      if (result.length === 0 || result[result.length - 1] !== valueB) {
        result.push(valueB);
      }
      pointerB++;
    }
    else {
      // Values match
      if (result.length === 0 || result[result.length - 1] !== valueA) {
        result.push(valueA);
      }
      pointerA++;
      pointerB++;
    }
  }

  // Append remaining elements from listA
  while (pointerA < listA.length) {
    const valueA = listA[pointerA];
    if (result.length === 0 || result[result.length - 1] !== valueA) {
      result.push(valueA);
    }
    pointerA++;
  }

  // Append remaining elements from listB
  while (pointerB < listB.length) {
    const valueB = listB[pointerB];
    if (result.length === 0 || result[result.length - 1] !== valueB) {
      result.push(valueB);
    }
    pointerB++;
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
 * Convert a raw value to a numeric value for range filtering.
 * Handles both number and date types based on field type.
 * @internal
 */
function toNumericRangeValue(raw: unknown, fieldType: FieldType): number | null {
  if (raw == null) {
    return null;
  }

  if (typeof raw === 'number') {
    return raw;
  }

  if (fieldType === 'date') {
    const parsed = Date.parse(String(raw));
    return Number.isNaN(parsed) ? null : parsed;
  }

  // For 'number' type fields that aren't already numbers, try to parse
  if (fieldType === 'number') {
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }

  // For 'string' or 'boolean' types, return null (invalid for ranges)
  return null;
}

/**
 * Filter indices array by range conditions, checking items at those indices.
 * Writes result to target array (clears and reuses it).
 * 
 * Range semantics:
 * - Range `min` and `max` values must be numbers
 * - For date fields, pass epoch milliseconds (e.g., `Date.parse(isoString)`)
 * - Items are included if their value is >= `min` (if provided) and <= `max` (if provided)
 */
export function filterIndicesByRange<T extends Record<string, unknown>>(
  indices: number[],
  items: T[],
  ranges: Record<string, RangeBound>,
  fieldTypes: Record<string, FieldType>,
  target: number[],
): void {
  target.length = 0; // Clear target array

  // Pre-compute field type lookups for fields actually in the query
  const rangeFields = Object.keys(ranges);
  
  for (const idx of indices) {
    const item = items[idx] as Record<string, unknown>;
    let passes = true;

    // Only process fields present in query.ranges
    for (const field of rangeFields) {
      const rawValue = item[field];
      const fieldType = fieldTypes[field];
      
      if (rawValue == null) {
        passes = false;
        break;
      }

      const numericValue = toNumericRangeValue(rawValue, fieldType);
      
      if (numericValue === null) {
        passes = false;
        break;
      }

      const range = ranges[field];
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
      target.push(idx);
    }
  }
}

