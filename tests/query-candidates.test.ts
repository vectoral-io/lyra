import { describe, it, expect } from 'vitest';
import { selectEqualCandidates } from '../src/query/candidates';
import type { InMemoryFacetIndex } from '../src/types';

/**
 * Direct unit seam for the equal-candidate selector — exercised end-to-end by
 * the query suite, but here we drive it with hand-built posting lists to pin
 * the intersection/union and buffer-reuse behavior in isolation.
 */

const ITEM_COUNT = 8;
const allIndices = Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
const bufs = () => [
  new Uint32Array(ITEM_COUNT),
  new Uint32Array(ITEM_COUNT),
  new Uint32Array(ITEM_COUNT),
] as const;

const index: InMemoryFacetIndex = {
  color: {
    red: Uint32Array.from([0, 2, 4, 6]),
    blue: Uint32Array.from([1, 3, 5]),
    green: Uint32Array.from([7]),
  },
  size: {
    small: Uint32Array.from([0, 1, 2, 3]),
    large: Uint32Array.from([4, 5, 6, 7]),
  },
};

function run(filters: Record<string, string | string[]>) {
  const [bufEqual, bufWorkA, bufWorkB] = bufs();
  const r = selectEqualCandidates(filters, index, allIndices, ITEM_COUNT, bufEqual, bufWorkA, bufWorkB);
  return r && Array.from(r.buf as ArrayLike<number>).slice(0, r.len);
}

describe('selectEqualCandidates', () => {
  it('empty filters return all indices', () => {
    expect(run({})).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('single field single value returns the posting list', () => {
    expect(run({ color: 'red' })).toEqual([0, 2, 4, 6]);
  });

  it('single field multi value unions (IN semantics)', () => {
    expect(run({ color: ['red', 'green'] })).toEqual([0, 2, 4, 6, 7]);
  });

  it('multi field intersects (AND)', () => {
    // red = [0,2,4,6] ∩ large = [4,5,6,7] => [4,6]
    expect(run({ color: 'red', size: 'large' })).toEqual([4, 6]);
  });

  it('multi field with a per-field union, intersected', () => {
    // (red ∪ blue) = [0,1,2,3,4,5,6] ∩ small = [0,1,2,3] => [0,1,2,3]
    expect(run({ color: ['red', 'blue'], size: 'small' })).toEqual([0, 1, 2, 3]);
  });

  it('unknown field fails closed (null)', () => {
    expect(run({ nope: 'x' })).toBeNull();
  });

  it('unmatched value fails closed (null)', () => {
    expect(run({ color: 'purple' })).toBeNull();
    expect(run({ color: 'red', size: 'purple' })).toBeNull();
  });
});
