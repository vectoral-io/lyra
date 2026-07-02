import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { intersectSorted, mergeUnionSorted, viewOf } from '../src/utils/array-operations';

// Direct coverage for the sorted-set primitives every query stage trusts. The
// bundle-level property test can't reach the galloping-intersection branch
// (its posting lists never differ in size by >64x) nor the K>=3 union reduction
// with enough variety, so pin them here against a plain Set/array oracle.

function sortedUnique(nums: number[]): Uint32Array {
  return new Uint32Array([...new Set(nums.map((n) => n >>> 0))].sort((a, b) => a - b));
}

function unionOracle(arrays: Uint32Array[]): number[] {
  const set = new Set<number>();
  for (const arr of arrays) for (const value of arr) set.add(value);
  return [...set].sort((a, b) => a - b);
}

function intersectOracle(listA: Uint32Array, listB: Uint32Array): number[] {
  const setB = new Set<number>(listB);
  return [...listA].filter((value) => setB.has(value)).sort((a, b) => a - b);
}

function runUnion(arrays: Uint32Array[]): number[] {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const target = new Uint32Array(total);
  const len = mergeUnionSorted(arrays, target);
  return [...target.subarray(0, len)];
}

function runIntersect(listA: Uint32Array, listB: Uint32Array): number[] {
  const target = new Uint32Array(Math.min(listA.length, listB.length));
  const len = intersectSorted(listA, listB, target);
  return [...target.subarray(0, len)];
}

describe('mergeUnionSorted', () => {
  it('handles 0, 1, and 2 input lists', () => {
    expect(runUnion([])).toEqual([]);
    expect(runUnion([sortedUnique([3, 1, 2])])).toEqual([1, 2, 3]);
    expect(runUnion([sortedUnique([1, 3, 5]), sortedUnique([2, 3, 6])])).toEqual([1, 2, 3, 5, 6]);
  });

  it('dedupes across lists and handles adjacency and disjoint ranges', () => {
    expect(runUnion([sortedUnique([1, 2, 3]), sortedUnique([1, 2, 3])])).toEqual([1, 2, 3]);
    expect(runUnion([sortedUnique([1, 2]), sortedUnique([3, 4])])).toEqual([1, 2, 3, 4]);
    expect(runUnion([sortedUnique([0, 5, 10]), new Uint32Array(0)])).toEqual([0, 5, 10]);
  });

  it('reduces K>=3 lists (odd and even counts) correctly', () => {
    const three = [sortedUnique([1, 4]), sortedUnique([2, 4]), sortedUnique([3, 4])];
    expect(runUnion(three)).toEqual([1, 2, 3, 4]);

    const five = [
      sortedUnique([10, 50]),
      sortedUnique([20, 50]),
      sortedUnique([30]),
      sortedUnique([40, 50]),
      sortedUnique([50, 60]),
    ];
    expect(runUnion(five)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('matches the Set oracle for 0..8 random sorted lists (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.nat(2000), { maxLength: 200 }).map(sortedUnique), { maxLength: 8 }),
        (arrays) => {
          expect(runUnion(arrays)).toEqual(unionOracle(arrays));
        },
      ),
      { numRuns: 300, seed: 0x0c7 },
    );
  });
});

describe('intersectSorted', () => {
  it('handles empty, disjoint, and identical inputs', () => {
    expect(runIntersect(new Uint32Array(0), sortedUnique([1, 2]))).toEqual([]);
    expect(runIntersect(sortedUnique([1, 3, 5]), sortedUnique([2, 4, 6]))).toEqual([]);
    expect(runIntersect(sortedUnique([1, 2, 3]), sortedUnique([1, 2, 3]))).toEqual([1, 2, 3]);
  });

  it('takes the galloping path when one list is >64x the other', () => {
    // big is 0..999 (1000 elems); small is 4 elems → ratio 250 > GALLOP_RATIO(64).
    const big = sortedUnique(Array.from({ length: 1000 }, (_, i) => i));
    const small = sortedUnique([0, 500, 999, 1500]); // 1500 absent from big
    expect(big.length / small.length).toBeGreaterThan(64);
    expect(runIntersect(small, big)).toEqual([0, 500, 999]);
    // Order of arguments must not matter (gallop picks the smaller side either way).
    expect(runIntersect(big, small)).toEqual([0, 500, 999]);
  });

  it('matches the Set oracle for skewed sizes that force galloping (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.nat(50), { minLength: 1, maxLength: 5 }).map(sortedUnique),
        fc.uniqueArray(fc.nat(20000), { minLength: 400, maxLength: 800 }).map(sortedUnique),
        (small, big) => {
          expect(big.length / small.length).toBeGreaterThan(64);
          expect(runIntersect(small, big)).toEqual(intersectOracle(small, big));
          expect(runIntersect(big, small)).toEqual(intersectOracle(big, small));
        },
      ),
      { numRuns: 300, seed: 0x0c8 },
    );
  });

  it('matches the Set oracle for comparable sizes (two-pointer path, property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(500), { maxLength: 300 }).map(sortedUnique),
        fc.array(fc.nat(500), { maxLength: 300 }).map(sortedUnique),
        (listA, listB) => {
          expect(runIntersect(listA, listB)).toEqual(intersectOracle(listA, listB));
        },
      ),
      { numRuns: 300, seed: 0x0c9 },
    );
  });
});

describe('viewOf', () => {
  it('returns a zero-copy prefix view for Uint32Array sources', () => {
    const source = sortedUnique([1, 2, 3, 4, 5]);
    const view = viewOf(source, 3);
    expect([...view]).toEqual([1, 2, 3]);
  });
});
