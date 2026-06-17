/**
 * Tiny binary writer/reader pair for the v4 bundle container.
 *
 * The writer accumulates chunks and concatenates once at finalization; the
 * reader operates over a single `Uint8Array` view. Both assume little-endian
 * byte order, consistent with all target runtimes.
 *
 * @internal
 */
export declare class BinaryWriter {
    private readonly chunks;
    private size;
    /** Current byte offset (== bytes written so far). */
    get cursor(): number;
    writeBytes(bytes: Uint8Array): void;
    writeU32LE(value: number): void;
    /** Write a UTF-8 encoded string and return the byte length written. */
    writeUtf8(str: string): number;
    /** Write the raw little-endian bytes of a Float64Array. */
    writeF64Bytes(arr: Float64Array): void;
    /** Pad with zeros until `cursor % boundary === 0`. */
    align(boundary: number): void;
    finalize(): Uint8Array;
}
export declare class BinaryReader {
    private readonly bytes;
    private off;
    constructor(bytes: Uint8Array);
    get cursor(): number;
    get length(): number;
    seek(offset: number): void;
    readBytes(len: number): Uint8Array;
    readU32LE(): number;
    readUtf8(len: number): string;
    /**
     * Read `len` bytes as a Float64Array. Returns a zero-copy view if the
     * underlying buffer offset is 8-byte aligned; otherwise allocates a fresh
     * Float64Array and copies bytes into it.
     */
    readF64View(off: number, len: number): Float64Array;
}
//# sourceMappingURL=binary.d.ts.map