/**
 * Tiny binary writer/reader pair for the v4 bundle container.
 *
 * The writer accumulates chunks and concatenates once at finalization; the
 * reader operates over a single `Uint8Array` view. Both assume little-endian
 * byte order, consistent with all target runtimes.
 *
 * @internal
 */

const U32_BYTES = 4;
const F64_BYTES = 8;

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export class BinaryWriter {
  private readonly chunks: Uint8Array[] = [];
  private size = 0;

  /** Current byte offset (== bytes written so far). */
  get cursor(): number {
    return this.size;
  }

  writeBytes(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    this.chunks.push(bytes);
    this.size += bytes.length;
  }

  writeU32LE(value: number): void {
    const buf = new Uint8Array(U32_BYTES);
    new DataView(buf.buffer).setUint32(0, value >>> 0, true);
    this.writeBytes(buf);
  }

  /** Write a UTF-8 encoded string and return the byte length written. */
  writeUtf8(str: string): number {
    const bytes = utf8Encoder.encode(str);
    this.writeBytes(bytes);
    return bytes.length;
  }

  /** Write the raw little-endian bytes of a Float64Array. */
  writeF64Bytes(arr: Float64Array): void {
    this.writeBytes(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
  }

  /** Pad with zeros until `cursor % boundary === 0`. */
  align(boundary: number): void {
    const rem = this.size % boundary;
    if (rem === 0) return;
    const pad = boundary - rem;
    this.writeBytes(new Uint8Array(pad));
  }

  finalize(): Uint8Array {
    const out = new Uint8Array(this.size);
    let off = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, off);
      off += chunk.length;
    }
    return out;
  }
}

export class BinaryReader {
  private off = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get cursor(): number {
    return this.off;
  }

  get length(): number {
    return this.bytes.length;
  }

  seek(offset: number): void {
    if (offset < 0 || offset > this.bytes.length) {
      throw new Error(`BinaryReader.seek: offset ${offset} out of bounds (length ${this.bytes.length})`);
    }
    this.off = offset;
  }

  readBytes(len: number): Uint8Array {
    if (this.off + len > this.bytes.length) {
      throw new Error(
        `BinaryReader.readBytes: requested ${len} at offset ${this.off}, only ${this.bytes.length - this.off} bytes remain`,
      );
    }
    const view = this.bytes.subarray(this.off, this.off + len);
    this.off += len;
    return view;
  }

  readU32LE(): number {
    const slice = this.readBytes(U32_BYTES);
    return new DataView(slice.buffer, slice.byteOffset, slice.byteLength).getUint32(0, true);
  }

  readUtf8(len: number): string {
    const slice = this.readBytes(len);
    return utf8Decoder.decode(slice);
  }

  /**
   * Read `len` bytes as a Float64Array. Returns a zero-copy view if the
   * underlying buffer offset is 8-byte aligned; otherwise allocates a fresh
   * Float64Array and copies bytes into it.
   */
  readF64View(off: number, len: number): Float64Array {
    if (!Number.isInteger(off) || off < 0 || !Number.isInteger(len) || len < 0) {
      throw new Error(`BinaryReader.readF64View: invalid range off=${off} len=${len}`);
    }
    if (off + len > this.bytes.length) {
      throw new Error(
        `BinaryReader.readF64View: range [${off}, ${off + len}) exceeds buffer length ${this.bytes.length}`,
      );
    }
    if (len % F64_BYTES !== 0) {
      throw new Error(`BinaryReader.readF64View: byte length ${len} is not a multiple of ${F64_BYTES}`);
    }
    const absoluteOffset = this.bytes.byteOffset + off;
    if (absoluteOffset % F64_BYTES === 0) {
      return new Float64Array(this.bytes.buffer, absoluteOffset, len / F64_BYTES);
    }
    const out = new Float64Array(len / F64_BYTES);
    new Uint8Array(out.buffer).set(this.bytes.subarray(off, off + len));
    return out;
  }
}
