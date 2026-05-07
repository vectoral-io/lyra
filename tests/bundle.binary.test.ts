import { describe, it, expect } from 'vitest';
import { LyraBundle } from '../src';
import { generateTicketArray, type Ticket } from './tickets.fixture';
import { DATASET_SIZE, testConfig } from './test-config';
import { decodeV4, encodeV4, isV4Bundle } from '../src/utils/binary-bundle';

describe('LyraBundle - v4 binary serialization', () => {
  it('serialize("binary") produces a Uint8Array starting with the LYRA4 magic', async () => {
    const tickets = generateTicketArray(100);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const bytes = bundle.serialize('binary');

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(isV4Bundle(bytes)).toBe(true);
    expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe('LYRA4');
  });

  it('serialize() with no args returns JSON (default)', async () => {
    const tickets = generateTicketArray(50);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const value = bundle.serialize();

    expect(value).not.toBeInstanceOf(Uint8Array);
    expect(value).toHaveProperty('manifest');
    expect(value).toHaveProperty('items');
  });

  it('round-trips queries via the v4 binary path', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const bytes = bundle.serialize('binary');
    const loaded = LyraBundle.loadBinary<Ticket>(bytes);

    const original = bundle.query({
      equal: { status: 'open' },
      ranges: { slaHours: { min: 0, max: 72 } },
    });
    const result = loaded.query({
      equal: { status: 'open' },
      ranges: { slaHours: { min: 0, max: 72 } },
    });

    expect(result.total).toBe(original.total);
    expect(result.items.length).toBe(original.items.length);
  });

  it('LyraBundle.load autodetects v4 binary input', async () => {
    const tickets = generateTicketArray(500);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const bytes = bundle.serialize('binary');
    const loaded = LyraBundle.load<Ticket>(bytes);

    const original = bundle.query({ equal: { status: 'open' } });
    const result = loaded.query({ equal: { status: 'open' } });

    expect(result.total).toBe(original.total);
    expect(result.items.length).toBe(original.items.length);
  });

  it('produces identical query results across JSON and binary load paths', async () => {
    const tickets = generateTicketArray(2_000);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const json = bundle.toJSON();
    const bytes = bundle.serialize('binary');

    const fromJson = LyraBundle.load<Ticket>(json);
    const fromBin = LyraBundle.loadBinary<Ticket>(bytes);

    const queries = [
      { equal: { status: 'open' } },
      { equal: { priority: ['high', 'urgent'] } },
      { equal: { status: 'open' }, ranges: { slaHours: { min: 0, max: 72 } } },
      { ranges: { slaHours: { min: 0, max: 72 } }, limit: 10 },
      { isNotNull: ['priority'] },
      { isNull: ['priority'] },
    ];
    for (const q of queries) {
      const a = fromJson.query(q);
      const b = fromBin.query(q);
      expect(b.total).toBe(a.total);
      expect(b.items.length).toBe(a.items.length);
    }
  });

  it('rejects buffers without the LYRA4 magic', async () => {
    expect(() => LyraBundle.loadBinary(new Uint8Array([1, 2, 3]))).toThrow('magic');
    expect(() => LyraBundle.loadBinary(new Uint8Array(0))).toThrow('magic');

    const wrongMagic = new Uint8Array(64);
    wrongMagic.set([0x4c, 0x59, 0x52, 0x41, 0x33], 0); // "LYRA3"
    expect(() => LyraBundle.loadBinary(wrongMagic)).toThrow('magic');
  });

  it('rejects buffers truncated mid-header', async () => {
    const tickets = generateTicketArray(50);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const bytes = bundle.serialize('binary');
    const truncated = bytes.subarray(0, 20);

    expect(() => LyraBundle.loadBinary(truncated)).toThrow();
  });

  it('rejects bundles with bogus header_len', async () => {
    const tickets = generateTicketArray(50);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const bytes = bundle.serialize('binary');
    const corrupted = bytes.slice();
    // Overwrite header_len at offset 9 (5 magic + 4 flags).
    new DataView(corrupted.buffer, corrupted.byteOffset).setUint32(9, 0xFFFFFFFF, true);

    expect(() => LyraBundle.loadBinary(corrupted)).toThrow();
  });

  it('produces zero-copy Float64Array views when alignment permits', async () => {
    const tickets = generateTicketArray(200);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const bytes = bundle.serialize('binary');
    const decoded = decodeV4<Ticket>(bytes);

    // Range columns should be Float64Array of length items.length.
    for (const field of Object.keys(decoded.rangeColumns)) {
      const col = decoded.rangeColumns[field];
      expect(col).toBeInstanceOf(Float64Array);
      expect(col.length).toBe(tickets.length);
      // Encoder emits 8-aligned offsets and pads body start to 8 — view should
      // share the underlying buffer (zero-copy).
      expect(col.buffer).toBe(bytes.buffer);
    }
  });

  it('encodeV4 / decodeV4 round-trip preserves all payload fields', async () => {
    const tickets = generateTicketArray(300);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

    const json = bundle.toJSON();
    // Reconstruct in-memory shapes from the JSON we just emitted to avoid
    // poking at private fields.
    const loaded = LyraBundle.load<Ticket>(json);
    const bytes = loaded.serialize('binary');
    const decoded = decodeV4<Ticket>(bytes);

    expect(decoded.manifest.version).toBe(json.manifest.version);
    expect(decoded.items.length).toBe(tickets.length);
    expect(Object.keys(decoded.facetIndex).sort()).toEqual(
      Object.keys(json.facetIndex).sort(),
    );
    expect(Object.keys(decoded.nullIndex).sort()).toEqual(
      Object.keys(json.nullIndex).sort(),
    );
  });

  it('rejects v4 bundles whose manifest version is outside 3.x / 4.x', async () => {
    const tickets = generateTicketArray(100);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const bytes = bundle.serialize('binary');
    const decoded = decodeV4<Ticket>(bytes);

    // Mutate the manifest to v2 and re-encode; loadBinary should reject.
    const corruptBytes = encodeV4<Ticket>({
      ...decoded,
      manifest: { ...decoded.manifest, version: '2.0.0' },
    });
    expect(() => LyraBundle.loadBinary<Ticket>(corruptBytes)).toThrow('Invalid bundle version');
  });
});
