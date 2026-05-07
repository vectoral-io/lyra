const TWO_ARRAYS = 2;

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
export function mergeUnionSorted(
  arrays: SortedSource[],
  target: Uint32Array,
): number {
  if (arrays.length === 0) return 0;

  if (arrays.length === 1) {
    const source = arrays[0];
    const len = source.length;
    for (let i = 0; i < len; i++) target[i] = source[i];
    return len;
  }

  if (arrays.length === TWO_ARRAYS) {
    return mergeUnionTwoSorted(arrays[0], arrays[1], target);
  }

  let current: SortedSource[] = arrays;
  while (current.length > TWO_ARRAYS) {
    const next: SortedSource[] = [];
    for (let i = 0; i < current.length; i += TWO_ARRAYS) {
      if (i + 1 >= current.length) {
        next.push(current[i]);
        continue;
      }
      const left = current[i];
      const right = current[i + 1];
      const merged = new Uint32Array(left.length + right.length);
      const len = mergeUnionTwoSorted(left, right, merged);
      next.push(len === merged.length ? merged : merged.subarray(0, len));
    }
    current = next;
  }

  return mergeUnionTwoSorted(current[0], current[1], target);
}

/**
 * Two-way sorted-deduped union into `target`. Returns number of values written.
 * @internal
 */
function mergeUnionTwoSorted(
  listA: SortedSource,
  listB: SortedSource,
  target: Uint32Array,
): number {
  let writeIndex = 0;
  let pointerA = 0;
  let pointerB = 0;
  const lenA = listA.length;
  const lenB = listB.length;

  while (pointerA < lenA && pointerB < lenB) {
    const valueA = listA[pointerA];
    const valueB = listB[pointerB];

    if (valueA < valueB) {
      if (writeIndex === 0 || target[writeIndex - 1] !== valueA) {
        target[writeIndex++] = valueA;
      }
      pointerA++;
    }
    else if (valueA > valueB) {
      if (writeIndex === 0 || target[writeIndex - 1] !== valueB) {
        target[writeIndex++] = valueB;
      }
      pointerB++;
    }
    else {
      if (writeIndex === 0 || target[writeIndex - 1] !== valueA) {
        target[writeIndex++] = valueA;
      }
      pointerA++;
      pointerB++;
    }
  }

  while (pointerA < lenA) {
    const valueA = listA[pointerA];
    if (writeIndex === 0 || target[writeIndex - 1] !== valueA) {
      target[writeIndex++] = valueA;
    }
    pointerA++;
  }

  while (pointerB < lenB) {
    const valueB = listB[pointerB];
    if (writeIndex === 0 || target[writeIndex - 1] !== valueB) {
      target[writeIndex++] = valueB;
    }
    pointerB++;
  }

  return writeIndex;
}


/**
 * Intersect two sorted, deduped sequences into `target`. Returns the number
 * of values written. Caller sizes `target` ≥ `min(listA.length, listB.length)`.
 *
 * Switches between two algorithms based on size skew:
 *  - Two-pointer merge when sizes are comparable: O(|A| + |B|).
 *  - Galloping (exponential then binary search) when one list is much larger:
 *    O(|small| · log(|large| / |small|)). Crosses over once the ratio exceeds
 *    `GALLOP_RATIO` (64), where galloping wins decisively.
 */
const GALLOP_RATIO = 64;

export function intersectSorted(
  listA: SortedSource,
  listB: SortedSource,
  target: Uint32Array,
): number {
  const lenA = listA.length;
  const lenB = listB.length;

  if (lenA === 0 || lenB === 0) return 0;

  if (lenA <= lenB) {
    if (lenB / lenA > GALLOP_RATIO) return gallopIntersect(listA, listB, target);
  }
  else if (lenA / lenB > GALLOP_RATIO) {
    return gallopIntersect(listB, listA, target);
  }

  let writeIndex = 0;
  let pointerA = 0;
  let pointerB = 0;

  while (pointerA < lenA && pointerB < lenB) {
    const valueA = listA[pointerA];
    const valueB = listB[pointerB];

    if (valueA < valueB) {
      pointerA++;
    }
    else if (valueA > valueB) {
      pointerB++;
    }
    else {
      target[writeIndex++] = valueA;
      pointerA++;
      pointerB++;
    }
  }

  return writeIndex;
}

/**
 * Galloping intersection: walk `small` in order, exponential-then-binary-search
 * for each value in `big`. Maintains a monotonic lower bound `lo` so total
 * search work stays O(|small| · log(|big| / |small|)).
 * @internal
 */
function gallopIntersect(
  small: SortedSource,
  big: SortedSource,
  target: Uint32Array,
): number {
  const lenSmall = small.length;
  const lenBig = big.length;
  let writeIndex = 0;
  let lo = 0;

  for (let i = 0; i < lenSmall; i++) {
    if (lo >= lenBig) break;
    const value = small[i];

    // Exponentially expand the search bound until big[lo + bound] >= value.
    let bound = 1;
    while (lo + bound < lenBig && big[lo + bound] < value) {
      bound <<= 1;
    }

    // Binary search in big[lo .. min(lo + bound, lenBig)) for value.
    let left = lo;
    let right = lo + bound < lenBig ? lo + bound : lenBig;
    while (left < right) {
      const mid = (left + right) >>> 1;
      if (big[mid] < value) left = mid + 1;
      else right = mid;
    }

    if (left < lenBig && big[left] === value) {
      target[writeIndex++] = value;
      lo = left + 1;
    }
    else {
      lo = left;
    }
  }

  return writeIndex;
}


