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

const B64_CHUNK = 0x8000;
const F64_BYTES = 8;
const VARINT_MAX_BYTES = 5;
const VARINT_CONTINUATION = 0x80;
const VARINT_PAYLOAD_MASK = 0x7f;
const VARINT_BITS_PER_BYTE = 7;

function bytesToB64(bytes: Uint8Array): string {
  let result = '';
  for (let off = 0; off < bytes.length; off += B64_CHUNK) {
    const slice = bytes.subarray(off, Math.min(off + B64_CHUNK, bytes.length));
    result += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(result);
}

function b64ToBytes(b64: string): Uint8Array {
  const decoded = atob(b64);
  const out = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i);
  return out;
}

/**
 * Encode a Float64Array as a base64 string of its little-endian bytes.
 */
export function f64ArrayToB64(arr: Float64Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  return bytesToB64(bytes);
}

/**
 * Decode a base64 string previously produced by `f64ArrayToB64` back into a
 * fresh Float64Array. The returned array owns its buffer; safe to retain.
 */
export function b64ToF64Array(b64: string): Float64Array {
  const bytes = b64ToBytes(b64);
  if (bytes.byteLength % F64_BYTES !== 0) {
    throw new Error(
      `b64ToF64Array: byte length ${bytes.byteLength} is not a multiple of ${F64_BYTES}`,
    );
  }
  const out = new Float64Array(bytes.byteLength / F64_BYTES);
  new Uint8Array(out.buffer).set(bytes);
  return out;
}

/**
 * Encode a sorted ascending Uint32Array as raw delta + LEB128 varint bytes.
 * @internal
 */
export function deltaVarintEncodeBytes(arr: Uint32Array): Uint8Array {
  // Worst case: VARINT_MAX_BYTES per u32.
  const buf = new Uint8Array(arr.length * VARINT_MAX_BYTES);
  let off = 0;
  let prev = 0;
  for (let i = 0; i < arr.length; i++) {
    let delta = arr[i] - prev;
    prev = arr[i];
    while (delta >= VARINT_CONTINUATION) {
      buf[off++] = (delta & VARINT_PAYLOAD_MASK) | VARINT_CONTINUATION;
      delta >>>= VARINT_BITS_PER_BYTE;
    }
    buf[off++] = delta & VARINT_PAYLOAD_MASK;
  }
  return buf.subarray(0, off);
}

/**
 * Inverse of `deltaVarintEncodeBytes`. Decodes a varint byte slice into a
 * sorted ascending Uint32Array. Pass `expectedLen` to skip bounds inference.
 * @internal
 */
export function deltaVarintDecodeBytes(bytes: Uint8Array, expectedLen?: number): Uint32Array {
  // Upper bound on element count: 1 byte per element (smallest delta encoding).
  const out = new Uint32Array(expectedLen ?? bytes.length);
  let off = 0;
  let count = 0;
  let prev = 0;
  while (off < bytes.length) {
    let shift = 0;
    let delta = 0;
    let byte = 0;
    do {
      if (off >= bytes.length) {
        throw new Error('deltaVarintDecode: truncated varint');
      }
      byte = bytes[off++];
      delta |= (byte & VARINT_PAYLOAD_MASK) << shift;
      shift += VARINT_BITS_PER_BYTE;
    } while ((byte & VARINT_CONTINUATION) !== 0);
    const value = (prev + (delta >>> 0)) >>> 0;
    out[count++] = value;
    prev = value;
  }
  if (expectedLen != null && count !== expectedLen) {
    throw new Error(
      `deltaVarintDecode: expected ${expectedLen} ints, decoded ${count}`,
    );
  }
  return count === out.length ? out : out.slice(0, count);
}

/**
 * Encode a sorted ascending Uint32Array as base64'd delta + LEB128 varints.
 *
 * Sorted dense posting lists compress dramatically here — most gaps fit in 1–2
 * bytes vs ~5–10 bytes/int as ASCII JSON.
 */
export function deltaVarintEncode(arr: Uint32Array): string {
  return bytesToB64(deltaVarintEncodeBytes(arr));
}

/**
 * Inverse of `deltaVarintEncode`. If `expectedLen` is provided the result is
 * tightly sized; otherwise sizing is inferred from the encoded byte stream.
 */
export function deltaVarintDecode(b64: string, expectedLen?: number): Uint32Array {
  return deltaVarintDecodeBytes(b64ToBytes(b64), expectedLen);
}
