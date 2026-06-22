import { describe, it, expect } from 'vitest';
import {
  deltaVarintEncodeBytes,
  deltaVarintDecodeBytes,
  b64ToF64Array,
  f64ArrayToB64,
} from '../src/utils/codec';

/**
 * The happy-path round-trips are covered by the serialize property tests; these
 * pin the error branches that guard against corrupt wire data.
 */
describe('codec error branches', () => {
  it('deltaVarintDecodeBytes throws on a truncated varint', () => {
    // A lone byte with the continuation bit set never terminates.
    expect(() => deltaVarintDecodeBytes(new Uint8Array([0x80]))).toThrow(/truncated varint/);
  });

  it('deltaVarintDecodeBytes throws when the decoded count != expectedLen', () => {
    const bytes = deltaVarintEncodeBytes(Uint32Array.from([1, 2, 3]));
    expect(() => deltaVarintDecodeBytes(bytes, 5)).toThrow(/expected 5 ints, decoded 3/);
  });

  it('deltaVarintDecodeBytes accepts a matching expectedLen', () => {
    const bytes = deltaVarintEncodeBytes(Uint32Array.from([1, 2, 3]));
    expect(Array.from(deltaVarintDecodeBytes(bytes, 3))).toEqual([1, 2, 3]);
  });

  it('b64ToF64Array throws when the byte length is not a multiple of 8', () => {
    // "AAAAAA==" decodes to 4 bytes — not a whole number of f64s.
    expect(() => b64ToF64Array('AAAAAA==')).toThrow(/not a multiple of 8/);
  });

  it('b64ToF64Array round-trips a valid f64 buffer', () => {
    const arr = Float64Array.from([1.5, -2, 1e10]);
    expect(Array.from(b64ToF64Array(f64ArrayToB64(arr)))).toEqual([1.5, -2, 1e10]);
  });
});
