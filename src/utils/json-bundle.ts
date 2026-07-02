/**
 * JSON (v3.x) wire format for Lyra bundles — the encode/decode counterpart to
 * `binary-bundle.ts`. `bundle.ts` owns neither format directly; it delegates to
 * this module for JSON and to `binary-bundle.ts` for the v4 binary container.
 *
 * v3.0 emits `facetIndex` / `nullIndex` as `number[]` posting lists. v3.1 adds
 * optional `facetIndexBin` / `nullIndexBin` (delta+varint base64) and
 * pre-encoded `rangeColumns`; loaders prefer those when present.
 *
 * Decoding here produces the in-memory structures but does NOT validate them —
 * callers run `validateDecodedBundle` (manifest, facet allow-list, posting
 * bounds) so validation stays single-owned across both wire formats.
 *
 *! NOTE: Any structural change here must be reflected in docs/bundle-json-spec.md
 *
 * @internal
 */

import type {
  FacetPostingLists,
  FacetPostingListsBin,
  InMemoryFacetIndex,
  InMemoryNullIndex,
  LyraBundleJSON,
  LyraManifest,
  NullPostingLists,
  NullPostingListsBin,
  RangeColumns,
  RangeColumnsJSON,
} from '../types';
import {
  b64ToF64Array,
  deltaVarintDecode,
  deltaVarintEncode,
  f64ArrayToB64,
} from './codec';

export interface JSONEncodeInput<T extends Record<string, unknown>> {
  manifest: LyraManifest;
  items: T[];
  facetIndex: InMemoryFacetIndex;
  nullIndex: InMemoryNullIndex;
  /** Range columns must be materialized by the caller so they ride along on the wire. */
  rangeColumns: RangeColumns;
}

export interface JSONDecodeOutput<T extends Record<string, unknown>> {
  manifest: LyraManifest;
  items: T[];
  facetIndex: InMemoryFacetIndex;
  nullIndex: InMemoryNullIndex;
  /** Null when the JSON carried no pre-encoded columns; caller rebuilds lazily. */
  rangeColumns: RangeColumns | null;
}

/**
 * Serialize in-memory bundle structures to the v3 JSON shape. Emits the v3.0
 * legacy `number[]` posting lists for back-compat plus the v3.1 binary fields
 * loaders prefer.
 */
export function encodeJSON<T extends Record<string, unknown>>(
  input: JSONEncodeInput<T>,
): LyraBundleJSON<T> {
  const facetIndex: FacetPostingLists = {};
  const facetIndexBin: FacetPostingListsBin = {};
  for (const field in input.facetIndex) {
    const byValue = input.facetIndex[field];
    const legacy: Record<string, number[]> = {};
    const binary: Record<string, string> = {};
    for (const valueKey in byValue) {
      const postings = byValue[valueKey];
      legacy[valueKey] = Array.from(postings);
      binary[valueKey] = deltaVarintEncode(postings);
    }
    facetIndex[field] = legacy;
    facetIndexBin[field] = binary;
  }

  const nullIndex: NullPostingLists = {};
  const nullIndexBin: NullPostingListsBin = {};
  for (const field in input.nullIndex) {
    const postings = input.nullIndex[field];
    nullIndex[field] = Array.from(postings);
    nullIndexBin[field] = deltaVarintEncode(postings);
  }

  const rangeColumns: RangeColumnsJSON = {};
  for (const field in input.rangeColumns) {
    rangeColumns[field] = { encoding: 'b64f64', data: f64ArrayToB64(input.rangeColumns[field]) };
  }

  return {
    manifest: input.manifest,
    items: input.items,
    facetIndex,
    nullIndex,
    rangeColumns,
    facetIndexBin,
    nullIndexBin,
  };
}

/**
 * Decode a v3 JSON bundle into in-memory structures. Prefers the v3.1 binary
 * blocks (`facetIndexBin` / `nullIndexBin`) over the legacy `number[]` lists.
 * Uses null-prototype maps so a bundle-controlled key like `"__proto__"` lands
 * as an own property instead of mutating a map prototype. Structural validation
 * (facet allow-list, posting bounds) is the caller's job via
 * `validateDecodedBundle`.
 */
export function decodeJSON<T extends Record<string, unknown>>(
  raw: LyraBundleJSON<T>,
): JSONDecodeOutput<T> {
  if (!raw || !raw.manifest || !raw.items) {
    throw new Error('Invalid bundle JSON: missing manifest or items');
  }

  const { manifest, items } = raw;
  const itemCount = items.length;

  const rawFacet: FacetPostingLists = raw.facetIndex ?? {};
  const rawFacetBin = raw.facetIndexBin;

  // Build over the union of legacy and binary field keys so fields not declared
  // in capabilities still surface for the allow-list check in validateDecodedBundle.
  const facetFields = new Set<string>(Object.keys(rawFacet));
  if (rawFacetBin) for (const field of Object.keys(rawFacetBin)) facetFields.add(field);

  const facetIndex: InMemoryFacetIndex = Object.create(null);
  for (const field of facetFields) {
    const out: Record<string, Uint32Array> = Object.create(null);
    const binByValue = rawFacetBin?.[field];
    if (binByValue) {
      for (const valueKey in binByValue) {
        out[valueKey] = deltaVarintDecode(binByValue[valueKey]);
      }
    }
    else {
      const byValue = rawFacet[field];
      if (byValue) {
        for (const valueKey in byValue) {
          out[valueKey] = postingsFromNumbers(byValue[valueKey], itemCount, `facetIndex["${field}"]`);
        }
      }
    }
    facetIndex[field] = out;
  }

  const nullIndex: InMemoryNullIndex = Object.create(null);
  const rawNull: NullPostingLists = raw.nullIndex ?? {};
  const rawNullBin = raw.nullIndexBin;
  if (rawNullBin) {
    for (const field in rawNullBin) {
      nullIndex[field] = deltaVarintDecode(rawNullBin[field]);
    }
  }
  else {
    for (const field in rawNull) {
      nullIndex[field] = postingsFromNumbers(rawNull[field], itemCount, `nullIndex["${field}"]`);
    }
  }

  let rangeColumns: RangeColumns | null = null;
  if (raw.rangeColumns) {
    rangeColumns = Object.create(null) as RangeColumns;
    for (const field in raw.rangeColumns) {
      const block = raw.rangeColumns[field];
      if (block.encoding !== 'b64f64') {
        throw new Error(
          `Invalid bundle: rangeColumns["${field}"] has unsupported encoding "${block.encoding}"`,
        );
      }
      rangeColumns[field] = b64ToF64Array(block.data);
    }
  }

  return { manifest, items, facetIndex, nullIndex, rangeColumns };
}

/**
 * Convert a JSON `number[]` posting list to a `Uint32Array`, rejecting any value
 * that is not an integer in `[0, itemCount)`. The bounds check happens here
 * rather than after conversion because `new Uint32Array` would silently wrap a
 * huge or negative value into an in-range one, masking a hostile bundle.
 */
function postingsFromNumbers(source: number[], itemCount: number, context: string): Uint32Array {
  const out = new Uint32Array(source.length);
  for (let i = 0; i < source.length; i++) {
    const value = source[i];
    if (!Number.isInteger(value) || value < 0 || value >= itemCount) {
      throw new Error(
        `Invalid bundle: ${context} posting index ${value} out of range [0, ${itemCount})`,
      );
    }
    out[i] = value;
  }
  return out;
}
