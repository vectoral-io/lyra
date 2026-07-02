import { describe, it, expect } from 'vitest';
import { createBundle, LyraBundle, type LyraBundleJSON } from '../src';
import { f64ArrayToB64 } from '../src/utils/codec';

// Behavior + robustness fixes from the elegance review. These pin semantics that
// the differential property test can't reach: forked value-equality (notEqual),
// alias fail-open, unknown-field policy, mixed-type inference, untrusted-load
// validation, and projection prototype-safety.

interface Row {
  id: string;
  tags: string[];
  n: number;
  [key: string]: unknown;
}

const ARRAY_FACET_ITEMS: Row[] = [
  { id: '1', tags: ['a', 'b'], n: 5 },
  { id: '2', tags: ['c'], n: 6 },
  { id: '3', tags: ['a'], n: 5 },
];

async function arrayFacetBundle(): Promise<LyraBundle<Row>> {
  return LyraBundle.create<Row>(ARRAY_FACET_ITEMS, {
    datasetId: 'array-facets',
    fields: {
      id: { kind: 'id', type: 'string' },
      tags: { kind: 'facet', type: 'string' },
      n: { kind: 'facet', type: 'number' },
    },
  });
}

describe('notEqual is the exact inverse of equal (value-matching via the facet-key codec)', () => {
  it('excludes items whose array-valued facet contains the value', async () => {
    const bundle = await arrayFacetBundle();
    const included = bundle.query({ equal: { tags: 'a' } });
    const excluded = bundle.query({ notEqual: { tags: 'a' } });

    expect(included.items.map((i) => i.id).sort()).toEqual(['1', '3']);
    // notEqual must exclude every item equal would include — the array-facet case
    // that previously slipped through (notEqual never excluded array facets).
    expect(excluded.items.map((i) => i.id)).toEqual(['2']);
    expect(included.total + excluded.total).toBe(ARRAY_FACET_ITEMS.length);
  });

  it('matches cross-type keys the same way equal does (numeric 5 vs string "5")', async () => {
    const bundle = await arrayFacetBundle();
    // String "5" against a numeric facet: equal matches the numeric 5 rows, so
    // notEqual must exclude exactly those rows.
    expect(bundle.query({ equal: { n: '5' } }).items.map((i) => i.id).sort()).toEqual(['1', '3']);
    expect(bundle.query({ notEqual: { n: '5' } }).items.map((i) => i.id)).toEqual(['2']);
  });
});

describe('alias resolution fails closed for equal, open for notEqual', () => {
  interface AliasRow { id: string; customerId: string; customerName: string; [key: string]: unknown }
  const items: AliasRow[] = [
    { id: '1', customerId: 'C-ACME', customerName: 'Acme' },
    { id: '2', customerId: 'C-GLOBEX', customerName: 'Globex' },
  ];

  async function aliasBundle(): Promise<LyraBundle<AliasRow>> {
    return createBundle<AliasRow>(items, {
      datasetId: 'aliases',
      id: 'id',
      equal: ['customerId'],
      aliases: { customerName: 'customerId' },
    }) as Promise<LyraBundle<AliasRow>>;
  }

  it('returns zero rows when every alias value is unmapped (not the whole dataset)', async () => {
    const bundle = await aliasBundle();
    expect(bundle.query({ equal: { customerName: 'Nonexistent Corp' } }).total).toBe(0);
    // Same as a canonical-field miss, which already failed closed.
    expect(bundle.query({ equal: { customerId: 'nope' } }).total).toBe(0);
  });

  it('resolves the mapped subset of a partially-unmapped alias list', async () => {
    const bundle = await aliasBundle();
    const result = bundle.query({ equal: { customerName: ['Acme', 'Nonexistent'] } });
    expect(result.items.map((i) => i.id)).toEqual(['1']);
  });

  it('drops an all-unmapped notEqual (excluding a nonexistent value excludes nothing)', async () => {
    const bundle = await aliasBundle();
    expect(bundle.query({ notEqual: { customerName: 'Nonexistent Corp' } }).total).toBe(items.length);
  });
});

describe('disposed bundles reject queries even on the unknown-field fast path', () => {
  it('throws for an unknown-field-only query after dispose', async () => {
    const bundle = await arrayFacetBundle();
    bundle.dispose();
    expect(() => bundle.query({ isNull: ['bogus'] })).toThrow(/disposed/);
    expect(() => bundle.query({ equal: { tags: 'a' } })).toThrow(/disposed/);
  });
});

describe('unknown-field queries fail closed uniformly', () => {
  async function bundle(): Promise<LyraBundle<Row>> {
    return arrayFacetBundle();
  }

  it('returns zero for a typo in any operator', async () => {
    const b = await bundle();
    expect(b.query({ equal: { bogus: 'x' } as never }).total).toBe(0);
    expect(b.query({ notEqual: { bogus: 'x' } as never }).total).toBe(0);
    expect(b.query({ isNull: ['bogus'] }).total).toBe(0);
    expect(b.query({ isNotNull: ['bogus'] }).total).toBe(0);
    expect(b.query({ ranges: { bogus: { min: 0 } } as never }).total).toBe(0);
  });
});

describe('mixed-type columns infer as string (no numeric mislabel)', () => {
  it('classifies a number/string column as string and decodes summary values without NaN', async () => {
    interface MixedRow { id: string; v: unknown; [key: string]: unknown }
    const items: MixedRow[] = [
      { id: '1', v: 5 },
      { id: '2', v: 'x' },
      { id: '3', v: 7 },
    ];
    const bundle = await createBundle<MixedRow>(items, {
      datasetId: 'mixed',
      id: 'id',
      equal: ['v'],
    });

    const field = bundle.describe().fields.find((f) => f.name === 'v');
    expect(field?.type).toBe('string');

    const summary = bundle.getFacetSummary('v');
    for (const { value } of summary.values) {
      expect(typeof value === 'number' && Number.isNaN(value)).toBe(false);
    }
    // All three distinct values survive as string keys.
    expect(summary.values.map((entry) => String(entry.value)).sort()).toEqual(['5', '7', 'x']);
  });
});

describe('load() rejects hostile bundles', () => {
  async function validJson(): Promise<LyraBundleJSON<Row>> {
    const bundle = await arrayFacetBundle();
    return bundle.toJSON();
  }

  it('accepts a well-formed round-trip', async () => {
    const json = await validJson();
    const loaded = LyraBundle.load<Row>(json);
    expect(loaded.query({ equal: { tags: 'a' } }).total).toBe(2);
  });

  it('rejects a facet posting index out of range (legacy number[] path)', async () => {
    const json = await validJson();
    // Point a posting at a row that does not exist.
    const firstField = Object.keys(json.facetIndex)[0];
    const firstKey = Object.keys(json.facetIndex[firstField])[0];
    json.facetIndex[firstField][firstKey] = [999];
    delete json.facetIndexBin; // force the legacy path
    expect(() => LyraBundle.load<Row>(json)).toThrow(/out of range/);
  });

  it('rejects a non-integer / wrapping posting value instead of silently coercing', async () => {
    const json = await validJson();
    const firstField = Object.keys(json.facetIndex)[0];
    const firstKey = Object.keys(json.facetIndex[firstField])[0];
    json.facetIndex[firstField][firstKey] = [2 ** 32 + 1]; // would wrap to 1 under Uint32Array
    delete json.facetIndexBin;
    expect(() => LyraBundle.load<Row>(json)).toThrow(/out of range/);
  });

  it('rejects a facet field not declared in capabilities', async () => {
    const json = await validJson();
    json.facetIndex.injected = { x: [0] };
    expect(() => LyraBundle.load<Row>(json)).toThrow(/not in capabilities/);
  });

  it('rejects a posting list that is not strictly increasing', async () => {
    const json = await validJson();
    const firstField = Object.keys(json.facetIndex)[0];
    const firstKey = Object.keys(json.facetIndex[firstField])[0];
    json.facetIndex[firstField][firstKey] = [1, 0]; // in range but descending
    delete json.facetIndexBin;
    expect(() => LyraBundle.load<Row>(json)).toThrow(/strictly increasing/);
  });

  it('rejects a non-array items payload', () => {
    const bad = { manifest: {}, items: { length: 3 } } as unknown as LyraBundleJSON<Row>;
    expect(() => LyraBundle.load<Row>(bad)).toThrow(/missing manifest or items/);
  });

  it('rejects a range column whose length does not match the item count', async () => {
    interface RangeRow { id: string; score: number; [key: string]: unknown }
    const bundle = await LyraBundle.create<RangeRow>(
      [{ id: '1', score: 10 }, { id: '2', score: 20 }],
      {
        datasetId: 'ranges',
        fields: {
          id: { kind: 'id', type: 'string' },
          score: { kind: 'range', type: 'number' },
        },
      },
    );
    const json = bundle.toJSON();
    // Re-encode the score column with the wrong number of rows.
    json.rangeColumns = { score: { encoding: 'b64f64', data: f64ArrayToB64(new Float64Array(5)) } };
    expect(() => LyraBundle.load<RangeRow>(json)).toThrow(/does not match item count/);
  });

  it('rejects a columnar length that exceeds the column data (allocation bomb)', async () => {
    const bundle = await arrayFacetBundle();
    const binary = bundle.serialize('binary');
    const tampered = reheader(binary, (header) => {
      // Claim a billion rows from a handful of bytes of column data.
      (header.blocks.items as { length: number }).length = 2 ** 30;
    });
    expect(() => LyraBundle.load<Row>(tampered)).toThrow(/exceeds capacity|row count/);
  });
});

describe('facet counts survive prototype-method-named values', () => {
  it('counts a facet value of "toString" without producing NaN', async () => {
    interface TagRow { id: string; tag: string; [key: string]: unknown }
    const items: TagRow[] = [
      { id: '1', tag: 'toString' },
      { id: '2', tag: 'toString' },
      { id: '3', tag: 'constructor' },
      { id: '4', tag: 'normal' },
    ];
    const bundle = await LyraBundle.create<TagRow>(items, {
      datasetId: 'proto-facets',
      fields: {
        id: { kind: 'id', type: 'string' },
        tag: { kind: 'facet', type: 'string' },
      },
    });

    const result = bundle.query({ includeFacetCounts: true, limit: 0 });
    const counts = result.facets?.tag ?? {};
    expect(counts.toString).toBe(2);
    expect(counts.constructor).toBe(1);
    expect(counts.normal).toBe(1);
    // And querying such a value works end to end.
    expect(bundle.query({ equal: { tag: 'toString' } }).total).toBe(2);
  });
});

describe('projection is prototype-safe', () => {
  it('does not pollute Object.prototype when a row carries an own __proto__ key', async () => {
    // JSON.parse yields an OWN "__proto__" data property (unlike an object literal).
    const row = JSON.parse('{"id":"1","__proto__":{"polluted":true}}') as Record<string, unknown>;
    const bundle = await LyraBundle.create<Record<string, unknown>>([row], {
      datasetId: 'proto',
      fields: { id: { kind: 'id', type: 'string' } },
    });

    const result = bundle.query({ select: ['id', '__proto__'] });
    expect(result.items.length).toBe(1);
    // The global prototype must be untouched.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(result.items[0])).toBe(Object.prototype);
  });
});

/**
 * Rebuild a v4 binary bundle with a mutated header. The body is position-
 * independent (block offsets are body-relative), so we only re-lay the header
 * and re-pad. Used to forge hostile bundles for the load-validation tests.
 */
function reheader(bytes: Uint8Array, mutate: (header: Record<string, unknown>) => void): Uint8Array {
  const MAGIC_LEN = 5;
  const HEADER_LEN_OFF = MAGIC_LEN + 4; // after magic + flags u32
  const HEADER_OFF = HEADER_LEN_OFF + 4;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = view.getUint32(HEADER_LEN_OFF, true);
  const headerJson = new TextDecoder().decode(bytes.subarray(HEADER_OFF, HEADER_OFF + headerLen));
  const header = JSON.parse(headerJson) as Record<string, unknown>;
  mutate(header);
  const newHeader = new TextEncoder().encode(JSON.stringify(header));

  const align8 = (n: number): number => (n + 7) & ~7;
  const oldBodyStart = align8(HEADER_OFF + headerLen);
  const body = bytes.subarray(oldBodyStart);
  const newBodyStart = align8(HEADER_OFF + newHeader.length);

  const out = new Uint8Array(newBodyStart + body.length);
  out.set(bytes.subarray(0, HEADER_OFF)); // magic + flags + (old headerLen slot, overwritten next)
  new DataView(out.buffer).setUint32(HEADER_LEN_OFF, newHeader.length, true);
  out.set(newHeader, HEADER_OFF);
  out.set(body, newBodyStart);
  return out;
}
