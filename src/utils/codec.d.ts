/**
 * Portable codecs used by the v3.1 JSON bundle format.
 *
 * No `Buffer`, no `node:` imports — works in browsers, Node 18+, and Bun.
 * Little-endian byte order is assumed for typed-array round-trips. All target
 * runtimes for Lyra are little-endian (x86/ARM); document this assumption if
 * we ever target a big-endian host.
 *
 * @internal
 */
/**
 * Encode a Float64Array as a base64 string of its little-endian bytes.
 */
export declare function f64ArrayToB64(arr: Float64Array): string;
/**
 * Decode a base64 string previously produced by `f64ArrayToB64` back into a
 * fresh Float64Array. The returned array owns its buffer; safe to retain.
 */
export declare function b64ToF64Array(b64: string): Float64Array;
/**
 * Encode a sorted ascending Uint32Array as raw delta + LEB128 varint bytes.
 * @internal
 */
export declare function deltaVarintEncodeBytes(arr: Uint32Array): Uint8Array;
/**
 * Inverse of `deltaVarintEncodeBytes`. Decodes a varint byte slice into a
 * sorted ascending Uint32Array. Pass `expectedLen` to skip bounds inference.
 * @internal
 */
export declare function deltaVarintDecodeBytes(bytes: Uint8Array, expectedLen?: number): Uint32Array;
/**
 * Encode a sorted ascending Uint32Array as base64'd delta + LEB128 varints.
 *
 * Sorted dense posting lists compress dramatically here — most gaps fit in 1–2
 * bytes vs ~5–10 bytes/int as ASCII JSON.
 */
export declare function deltaVarintEncode(arr: Uint32Array): string;
/**
 * Inverse of `deltaVarintEncode`. If `expectedLen` is provided the result is
 * tightly sized; otherwise sizing is inferred from the encoded byte stream.
 */
export declare function deltaVarintDecode(b64: string, expectedLen?: number): Uint32Array;
//# sourceMappingURL=codec.d.ts.map