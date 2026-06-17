/**
 * Binary container format v4 for Lyra bundles.
 *
 * Layout:
 * ```
 * +-----------------------------------------------+
 * | magic       : 5 bytes "LYRA4"                 |
 * | flags       : u32 LE  (reserved; 0 in v4.x)   |
 * | header_len  : u32 LE                          |
 * | header JSON : header_len bytes UTF-8          |
 * | (pad to 8-byte boundary)                      |
 * | body                                          |
 * |   - items block        (UTF-8 JSON | columns) |
 * |   - facetIndex block   (varint posting lists) |
 * |   - nullIndex block    (varint posting lists) |
 * |   - rangeColumns block (raw f64, 8B aligned)  |
 * +-----------------------------------------------+
 * ```
 *
 * v4.1 introduced the columnar items encoding (`items.encoding === 'columnar'`).
 * v4.0 emitted only `items.encoding === 'json'`. Both are still acceptable on
 * the read path; new bundles default to columnar for smaller wire size and
 * faster cold-start hydrate.
 *
 * Block offsets in the header are body-relative; the reader resolves them
 * against `bodyStart`, which is the first 8-byte-aligned offset after the
 * header. This lets the encoder compose body and header independently.
 *
 * @internal
 */
import type { InMemoryFacetIndex, InMemoryNullIndex, LyraManifest, RangeColumns } from '../types';
import { type Column } from './item-store';
export type V4ItemsInput<T extends Record<string, unknown>> = {
    kind: 'rows';
    rows: T[];
} | {
    kind: 'columnar';
    columns: Record<string, Column>;
    fieldNames: string[];
    length: number;
};
export type V4ItemsOutput<T extends Record<string, unknown>> = {
    kind: 'rows';
    rows: T[];
} | {
    kind: 'columnar';
    columns: Record<string, Column>;
    fieldNames: string[];
    length: number;
};
export interface V4Payload<T extends Record<string, unknown>> {
    manifest: LyraManifest;
    items: V4ItemsInput<T>;
    facetIndex: InMemoryFacetIndex;
    nullIndex: InMemoryNullIndex;
    rangeColumns: RangeColumns;
}
export interface V4DecodedBundle<T extends Record<string, unknown>> {
    manifest: LyraManifest;
    items: V4ItemsOutput<T>;
    facetIndex: InMemoryFacetIndex;
    nullIndex: InMemoryNullIndex;
    rangeColumns: RangeColumns;
}
/**
 * Returns true if `bytes` begins with the v4 magic header.
 */
export declare function isV4Bundle(bytes: Uint8Array): boolean;
export declare function encodeV4<T extends Record<string, unknown>>(payload: V4Payload<T>, options?: {
    itemsFormat?: 'columnar' | 'json';
}): Uint8Array;
export declare function decodeV4<T extends Record<string, unknown>>(bytes: Uint8Array): V4DecodedBundle<T>;
//# sourceMappingURL=binary-bundle.d.ts.map