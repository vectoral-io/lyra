import * as arrayOps from '../utils/array-operations';
import { viewOf, type SortedSource } from '../utils/array-operations';
import { encodeFacetKey } from './facet-key';
import type { FacetCounts, InMemoryFacetIndex, Scalar } from '../types';
import type { ItemStore } from '../utils/item-store';

/**
 * Query-execution helpers that read the facet index and item store. Kept beside
 * the other query stages (normalize, filters) rather than inline in the bundle
 * facade; `LyraBundle.query` orchestrates these and the filters, passing in its
 * scratch buffers as a workspace.
 */

/**
 * Resolve one equal-filter field's value(s) to a posting list. A single value
 * returns the field's posting list by reference; multiple values union into
 * `unionTarget`. Returns null when nothing matches (caller fails the query
 * closed). When the result is written into `unionTarget`, `postings` is that
 * buffer — callers that must hold the result across later buffer reuse should
 * copy it out.
 */
function resolveFieldPostings(
  byValue: Record<string, Uint32Array>,
  value: Scalar | Scalar[],
  unionTarget: Uint32Array,
): { postings: SortedSource; len: number } | null {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0) return null;

  if (values.length === 1) {
    const postings = byValue[encodeFacetKey(values[0])];
    if (!postings || postings.length === 0) return null;
    return { postings, len: postings.length };
  }

  const postingsArrays: SortedSource[] = [];
  for (const candidateValue of values) {
    const postings = byValue[encodeFacetKey(candidateValue)];
    if (postings && postings.length > 0) postingsArrays.push(postings);
  }
  if (postingsArrays.length === 0) return null;
  if (postingsArrays.length === 1) {
    return { postings: postingsArrays[0], len: postingsArrays[0].length };
  }
  const len = arrayOps.mergeUnionSorted(postingsArrays, unionTarget);
  return { postings: unionTarget, len };
}

/**
 * Select the candidate index set matching `equalFilters` (AND across fields, IN
 * within a field). Returns the cached `allIndices` for an empty filter, or null
 * if any field has no matches. Posting lists return by reference where possible;
 * unions and the K-way intersection use the provided scratch buffers.
 */
export function selectEqualCandidates(
  equalFilters: Record<string, Scalar | Scalar[]>,
  facetIndex: InMemoryFacetIndex,
  allIndices: Uint32Array,
  itemCount: number,
  bufEqual: Uint32Array,
  bufWorkA: Uint32Array,
  bufWorkB: Uint32Array,
): { buf: SortedSource; len: number } | null {
  const fields = Object.keys(equalFilters);
  if (fields.length === 0) return { buf: allIndices, len: itemCount };

  // Single-field fast path. Avoids per-query allocation: posting lists return
  // by reference; a multi-value union writes directly into bufEqual.
  if (fields.length === 1) {
    const field = fields[0];
    const byValue = facetIndex[field];
    if (!byValue) return null;
    const resolved = resolveFieldPostings(byValue, equalFilters[field], bufEqual);
    return resolved && { buf: resolved.postings, len: resolved.len };
  }

  // Multi-field path. Each field contributes a posting list (or per-field
  // union); intersect smallest-first using bufWorkA/bufWorkB ping-pong and land
  // the final result in bufEqual.
  interface FacetEntry { postings: SortedSource; size: number }
  const entries: FacetEntry[] = [];

  for (const field of fields) {
    const byValue = facetIndex[field];
    if (!byValue) return null;
    const resolved = resolveFieldPostings(byValue, equalFilters[field], bufWorkA);
    if (!resolved) return null;
    // A per-field union lands in the shared bufWorkA; copy it out so it survives
    // the K-way intersection below (which reuses bufWorkA as a ping-pong target).
    const postings = resolved.postings === bufWorkA
      ? bufWorkA.slice(0, resolved.len)
      : resolved.postings;
    entries.push({ postings, size: resolved.len });
  }

  entries.sort((entryA, entryB) => entryA.size - entryB.size);

  let current: SortedSource = entries[0].postings;
  let currentLen = entries[0].size;
  let workTarget: Uint32Array = bufWorkA;
  let workOther: Uint32Array = bufWorkB;
  for (let i = 1; i < entries.length; i++) {
    const finalRound = i === entries.length - 1;
    const target = finalRound ? bufEqual : workTarget;
    const written = arrayOps.intersectSorted(
      viewOf(current, currentLen),
      entries[i].postings,
      target,
    );
    if (written === 0) return null;
    current = target;
    currentLen = written;
    if (!finalRound) {
      const swap = workTarget; workTarget = workOther; workOther = swap;
    }
  }
  return { buf: bufEqual, len: currentLen };
}

/**
 * Increment `bucket[key]`, treating a non-numeric current value as 0. The guard
 * keeps a facet value that stringifies to an inherited method name ("toString",
 * "valueOf", …) correct: the first read sees the inherited function, coerces to
 * 0, and the write then shadows it with an own numeric property. Plain objects
 * stay fast here (monomorphic, low-cardinality facets) where a null-proto object
 * or Map would run slower. A literal "__proto__" value is the one pathological
 * case — its write is ignored — but that neither pollutes nor throws.
 */
function bump(bucket: Record<string, number>, key: string): void {
  const current = bucket[key];
  bucket[key] = (typeof current === 'number' ? current : 0) + 1;
}

/**
 * Count facet values across a candidate index set (canonical facets only).
 * Array-valued facets contribute one count per element.
 */
export function computeFacetCounts<T extends Record<string, unknown>>(
  itemStore: ItemStore<T>,
  indices: SortedSource,
  indicesLen: number,
  facetFields: string[],
): FacetCounts {
  const counts: FacetCounts = {};
  for (const field of facetFields) counts[field] = {};

  for (let i = 0; i < indicesLen; i++) {
    const idx = indices[i];
    for (const field of facetFields) {
      const raw = itemStore.getField(idx, field);
      if (raw === undefined || raw === null) continue;
      const bucket = counts[field];
      if (Array.isArray(raw)) {
        for (const value of raw) bump(bucket, encodeFacetKey(value));
      }
      else {
        bump(bucket, encodeFacetKey(raw));
      }
    }
  }
  return counts;
}
