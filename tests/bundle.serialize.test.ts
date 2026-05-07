import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { LyraBundle, type LyraBundleJSON } from '../src';
import { generateTicketArray, type Ticket } from './tickets.fixture';
import { DATASET_SIZE, testConfig } from './test-config';
import {
  b64ToF64Array,
  deltaVarintDecode,
  deltaVarintEncode,
  f64ArrayToB64,
} from '../src/utils/codec';

// Helpers
// ==============================

function stripV31Fields<T>(json: LyraBundleJSON<T>): LyraBundleJSON<T> {
  const { rangeColumns: _rc, facetIndexBin: _fb, nullIndexBin: _nb, ...legacy } = json;
  return legacy as LyraBundleJSON<T>;
}

function stripLegacyFields<T>(json: LyraBundleJSON<T>): LyraBundleJSON<T> {
  // Keep manifest/items + only the v3.1 binary blocks. Loaders should prefer
  // the binary blocks even when legacy fields are absent.
  return {
    manifest: json.manifest,
    items: json.items,
    facetIndex: {},
    nullIndex: {},
    rangeColumns: json.rangeColumns,
    facetIndexBin: json.facetIndexBin,
    nullIndexBin: json.nullIndexBin,
  };
}

// Codec round-trip
// ==============================

describe('codec — f64ArrayToB64 / b64ToF64Array', () => {
  it('round-trips an empty array', () => {
    const round = b64ToF64Array(f64ArrayToB64(new Float64Array(0)));
    expect(round.length).toBe(0);
  });

  it('round-trips arbitrary doubles including NaN/Inf/±0', () => {
    const samples = new Float64Array([
      0, -0, 1, -1, Math.PI, -Math.PI,
      Number.MIN_VALUE, Number.MAX_VALUE,
      Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER,
      Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY,
      Number.NaN,
    ]);
    const round = b64ToF64Array(f64ArrayToB64(samples));
    expect(round.length).toBe(samples.length);
    for (let i = 0; i < samples.length; i++) {
      if (Number.isNaN(samples[i])) expect(Number.isNaN(round[i])).toBe(true);
      else expect(round[i]).toBe(samples[i]);
    }
  });

  it('property: round-trip preserves bytes exactly', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ noNaN: true }), { minLength: 0, maxLength: 1024 }),
        (arr) => {
          const f = new Float64Array(arr);
          const round = b64ToF64Array(f64ArrayToB64(f));
          expect(round.length).toBe(f.length);
          for (let i = 0; i < f.length; i++) expect(round[i]).toBe(f[i]);
        },
      ),
    );
  });
});

describe('codec — deltaVarintEncode / Decode', () => {
  it('round-trips an empty array', () => {
    const round = deltaVarintDecode(deltaVarintEncode(new Uint32Array(0)));
    expect(round.length).toBe(0);
  });

  it('round-trips a single element', () => {
    const arr = new Uint32Array([42]);
    expect(Array.from(deltaVarintDecode(deltaVarintEncode(arr)))).toEqual([42]);
  });

  it('round-trips a long sorted ascending list', () => {
    const arr = new Uint32Array(10_000);
    let acc = 0;
    for (let i = 0; i < arr.length; i++) {
      acc += 1 + (i % 17);
      arr[i] = acc;
    }
    const round = deltaVarintDecode(deltaVarintEncode(arr));
    expect(round.length).toBe(arr.length);
    for (let i = 0; i < arr.length; i++) expect(round[i]).toBe(arr[i]);
  });

  it('round-trips with explicit expectedLen', () => {
    const arr = new Uint32Array([1, 5, 10, 100, 1000]);
    const round = deltaVarintDecode(deltaVarintEncode(arr), arr.length);
    expect(round.length).toBe(arr.length);
    expect(Array.from(round)).toEqual([1, 5, 10, 100, 1000]);
  });

  it('property: round-trip preserves sorted ascending u32 lists', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 0, maxLength: 200 }),
        (raw) => {
          const sorted = Array.from(new Set(raw)).sort((firstValue, secondValue) =>
            firstValue - secondValue,
          );
          const arr = new Uint32Array(sorted);
          const round = deltaVarintDecode(deltaVarintEncode(arr));
          expect(round.length).toBe(arr.length);
          for (let i = 0; i < arr.length; i++) expect(round[i]).toBe(arr[i]);
        },
      ),
    );
  });
});

// Bundle round-trip
// ==============================

describe('LyraBundle - v3.1 serialization', () => {
  it('toJSON emits both legacy and binary fields', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const json = bundle.toJSON();

    expect(json.facetIndex).toBeTruthy();
    expect(json.nullIndex).toBeTruthy();
    expect(json.facetIndexBin).toBeTruthy();
    expect(json.nullIndexBin).toBeTruthy();
    expect(json.rangeColumns).toBeTruthy();

    // Range columns: one entry per range field.
    for (const fieldName of testConfig.fields ? Object.keys(testConfig.fields) : []) {
      const def = testConfig.fields![fieldName as keyof typeof testConfig.fields];
      if (def?.kind === 'range') {
        expect(json.rangeColumns![fieldName]).toBeTruthy();
        expect(json.rangeColumns![fieldName].encoding).toBe('b64f64');
      }
    }
  });

  it('round-trips queries via the v3.1 binary path', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const json = bundle.toJSON();

    const loaded = LyraBundle.load<Ticket>(stripLegacyFields(json));

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

  it('round-trips queries via the legacy v3.0 path (binary fields stripped)', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const json = bundle.toJSON();

    const loaded = LyraBundle.load<Ticket>(stripV31Fields(json));

    const original = bundle.query({
      equal: { priority: 'high' },
      ranges: { slaHours: { min: 0, max: 72 } },
    });
    const result = loaded.query({
      equal: { priority: 'high' },
      ranges: { slaHours: { min: 0, max: 72 } },
    });

    expect(result.total).toBe(original.total);
    expect(result.items.length).toBe(original.items.length);
  });

  it('produces identical query results across legacy and binary load paths', async () => {
    const tickets = generateTicketArray(2_000);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const json = bundle.toJSON();

    const legacyLoaded = LyraBundle.load<Ticket>(stripV31Fields(json));
    const binaryLoaded = LyraBundle.load<Ticket>(stripLegacyFields(json));

    const queries = [
      { equal: { status: 'open' } },
      { equal: { priority: ['high', 'urgent'] } },
      { equal: { status: 'open' }, ranges: { slaHours: { min: 0, max: 72 } } },
      { ranges: { slaHours: { min: 0, max: 72 } }, limit: 10 },
      { isNotNull: ['priority'] },
      { isNull: ['priority'] },
    ];
    for (const q of queries) {
      const a = legacyLoaded.query(q);
      const b = binaryLoaded.query(q);
      expect(b.total).toBe(a.total);
      expect(b.items.length).toBe(a.items.length);
    }
  });

  it('rejects rangeColumns blocks with unsupported encoding', async () => {
    const tickets = generateTicketArray(100);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const json = bundle.toJSON();
    if (json.rangeColumns) {
      const firstKey = Object.keys(json.rangeColumns)[0];
      json.rangeColumns[firstKey] = {
        encoding: 'not-a-real-encoding' as 'b64f64',
        data: '',
      };
    }

    expect(() => LyraBundle.load<Ticket>(json)).toThrow('unsupported encoding');
  });
});
