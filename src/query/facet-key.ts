import type { FieldType } from '../types';

/**
 * The facet-key codec. A facet's posting-list map, its facet counts, and its
 * equality lookups all key on the same string derived from a value — so that
 * rule lives in exactly one place here, and `decodeFacetKey` is its inverse.
 *
 * Keep `encodeFacetKey` and `decodeFacetKey` in sync: if you change how a value
 * becomes a key, change how a key becomes a value in the same edit.
 */

/**
 * Encode a facet value to its canonical index key.
 *
 * Accepts `unknown` because facet values arrive untyped from item rows; in
 * practice they are string/number/boolean scalars (or elements of an array of
 * those). Non-scalars are out of contract and stringify per `String`.
 */
export function encodeFacetKey(value: unknown): string {
  return String(value);
}

/**
 * Decode an index key back to its typed value for a given facet field type.
 * Inverse of {@link encodeFacetKey}; used by `getFacetSummary` to report typed
 * values.
 *
 * For `date`, prefer a numeric reading (epoch-millisecond facet values are the
 * common case and `String(epoch)` is not a `Date.parse`-able format), then fall
 * back to `Date.parse` for ISO strings; an unparseable key passes through.
 */
export function decodeFacetKey(fieldType: FieldType, key: string): string | number | boolean {
  switch (fieldType) {
    case 'number':
      return Number(key);
    case 'boolean':
      return key === 'true';
    case 'date': {
      const asNumber = Number(key);
      if (key.trim() !== '' && Number.isFinite(asNumber)) return asNumber;
      const parsed = Date.parse(key);
      return Number.isNaN(parsed) ? key : parsed;
    }
    default:
      return key;
  }
}
