import { describe, it, expect } from 'vitest';
import { createBundle, LyraBundle } from '../src';

/**
 * Deserialization hardening regressions. The threat model is an untrusted or
 * malformed bundle reaching `load`/`loadBinary` (browser, edge, agent tool).
 */

const HEADER_START = 13; // magic(5) + flags(u32) + header_len(u32)
const ALIGN = 8;
const align8 = (n: number) => (n + (ALIGN - 1)) & ~(ALIGN - 1);

/**
 * Rebuild a v4 buffer with its header JSON transformed, fixing up header_len
 * and body alignment so block offsets (body-relative) still resolve. Lets a
 * test forge the exact malformed headers an attacker could craft.
 */
function rebuildBinary(bytes: Uint8Array, transform: (headerJson: string) => string): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = dv.getUint32(9, true); // magic(5) + flags(4), then header_len
  const headerJson = new TextDecoder().decode(bytes.subarray(HEADER_START, HEADER_START + headerLen));
  const newHeader = new TextEncoder().encode(transform(headerJson));
  const body = bytes.subarray(align8(HEADER_START + headerLen));
  const newBodyStart = align8(HEADER_START + newHeader.length);

  const out = new Uint8Array(newBodyStart + body.length);
  out.set(bytes.subarray(0, HEADER_START), 0); // magic + flags + header_len slot
  new DataView(out.buffer).setUint32(9, newHeader.length, true); // corrected header_len
  out.set(newHeader, HEADER_START);
  out.set(body, newBodyStart);
  return out;
}

async function sampleBinary(): Promise<Uint8Array> {
  const bundle = await createBundle([{ id: 'a', color: 'x' }], {
    datasetId: 'sec',
    equal: ['color'],
  });
  return bundle.serialize('binary');
}

describe('deserialization hardening', () => {
  it('control: the unmodified sample bundle loads and queries', async () => {
    const bytes = await sampleBinary();
    const bundle = LyraBundle.loadBinary(bytes);
    expect(bundle.query({ equal: { color: 'x' } }).total).toBe(1);
  });

  it('rejects a block slot with a negative offset (no wrong-bytes view)', async () => {
    const bytes = await sampleBinary();
    const tampered = rebuildBinary(bytes, (json) => {
      const h = JSON.parse(json);
      const field = Object.keys(h.blocks.facetIndex)[0];
      const value = Object.keys(h.blocks.facetIndex[field])[0];
      h.blocks.facetIndex[field][value].off = -8;
      return JSON.stringify(h);
    });
    expect(() => LyraBundle.loadBinary(tampered)).toThrow(/invalid off\/len/);
  });

  it('rejects a block slot with a fractional offset', async () => {
    const bytes = await sampleBinary();
    const tampered = rebuildBinary(bytes, (json) => {
      const h = JSON.parse(json);
      const field = Object.keys(h.blocks.facetIndex)[0];
      const value = Object.keys(h.blocks.facetIndex[field])[0];
      h.blocks.facetIndex[field][value].off = 1.5;
      return JSON.stringify(h);
    });
    expect(() => LyraBundle.loadBinary(tampered)).toThrow(/invalid off\/len/);
  });

  it('rejects an out-of-bounds offset rather than reading past the buffer', async () => {
    const bytes = await sampleBinary();
    const tampered = rebuildBinary(bytes, (json) => {
      const h = JSON.parse(json);
      const field = Object.keys(h.blocks.facetIndex)[0];
      const value = Object.keys(h.blocks.facetIndex[field])[0];
      h.blocks.facetIndex[field][value].off = 1_000_000;
      return JSON.stringify(h);
    });
    expect(() => LyraBundle.loadBinary(tampered)).toThrow(/exceeds buffer length/);
  });

  it('does not let a "__proto__" facet field slip past the capability allow-list', async () => {
    const bytes = await sampleBinary();
    // Inject a literal __proto__ key into the facetIndex block. With null-proto
    // index maps it lands as an own key visible to Object.keys, so the
    // capability check rejects it; on a plain {} it would have silently set the
    // prototype and bypassed the check.
    const tampered = rebuildBinary(bytes, (json) =>
      json.replace('"facetIndex":{', '"facetIndex":{"__proto__":{},'),
    );
    expect(() => LyraBundle.loadBinary(tampered)).toThrow(/not in capabilities\.facets/);
  });

  it('JSON load with a "__proto__" facet value key does not pollute Object.prototype', () => {
    const evil = JSON.parse(
      `{"manifest":{"version":"4.1.0","datasetId":"t","builtAt":"2026-01-01T00:00:00.000Z",`
      + `"fields":[{"name":"id","kind":"id","type":"string","ops":["eq","in"]},`
      + `{"name":"c","kind":"facet","type":"string","ops":["eq","in"]}],`
      + `"capabilities":{"facets":["c"],"ranges":[]}},`
      + `"items":[{"id":"a","c":"x"}],`
      + `"facetIndex":{"c":{"__proto__":[0],"x":[0]}},"nullIndex":{}}`,
    );
    const bundle = LyraBundle.load<{ id: string; c: string }>(evil);
    // The "__proto__" key is treated as an ordinary facet value (own key on a
    // null-prototype map), not a prototype mutation: it's queryable as data...
    expect(bundle.query({ equal: { c: '__proto__' } }).total).toBe(1);
    // ...and a fresh object's prototype is untouched (no global pollution).
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});
