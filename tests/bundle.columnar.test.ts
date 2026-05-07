import { describe, it, expect } from 'vitest';
import { LyraBundle, type LyraBundleJSON } from '../src';
import { generateTicketArray, type Ticket } from './tickets.fixture';
import { DATASET_SIZE, testConfig } from './test-config';
import { encodeV4, decodeV4 } from '../src/utils/binary-bundle';
import { ColumnarItemStore, RowItemStore, encodeColumns } from '../src/utils/item-store';

describe('Columnar items - v4.1', () => {
  it('default binary serialization produces columnar items', async () => {
    const tickets = generateTicketArray(500);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const bytes = bundle.serialize('binary');

    const decoded = decodeV4<Ticket>(bytes);
    expect(decoded.items.kind).toBe('columnar');
  });

  it('round-trips materialized rows deep-equal originals', async () => {
    const tickets = generateTicketArray(200);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const bytes = bundle.serialize('binary');
    const loaded = LyraBundle.loadBinary<Ticket>(bytes);

    const result = loaded.query({ limit: 200 });
    expect(result.items.length).toBe(tickets.length);

    for (let i = 0; i < tickets.length; i++) {
      const original = tickets[i] as Record<string, unknown>;
      const round = result.items[i] as Record<string, unknown>;
      // Filter to keys present in the original — columnar emits only fields it
      // saw, plus v3 JSON might omit undefined.
      for (const key of Object.keys(original)) {
        if (original[key] === undefined) continue;
        expect(round[key]).toEqual(original[key]);
      }
    }
  });

  it('preserves null vs falsy values in columnar form', async () => {
    type Row = { id: string; flag: boolean | null; name: string | null; n: number | null };
    const rows: Row[] = [
      { id: '1', flag: true, name: 'alice', n: 0 },
      { id: '2', flag: false, name: '', n: null },
      { id: '3', flag: null, name: null, n: -1 },
      { id: '4', flag: true, name: 'bob', n: 42 },
    ];

    const { columns, fieldNames } = encodeColumns(rows);
    const store = new ColumnarItemStore<Row>(columns, fieldNames, rows.length);

    expect(store.getField(0, 'flag')).toBe(true);
    expect(store.getField(1, 'flag')).toBe(false);
    expect(store.getField(2, 'flag')).toBeUndefined();
    expect(store.getField(0, 'name')).toBe('alice');
    expect(store.getField(1, 'name')).toBe('');
    expect(store.getField(2, 'name')).toBeUndefined();
    expect(store.getField(0, 'n')).toBe(0);
    expect(store.getField(1, 'n')).toBeUndefined();
    expect(store.getField(2, 'n')).toBe(-1);
  });

  it('handles array-valued fields via json-fallback', async () => {
    type Row = { id: string; tags: string[] };
    const rows: Row[] = [
      { id: '1', tags: ['bug', 'p0'] },
      { id: '2', tags: [] },
      { id: '3', tags: ['feature'] },
    ];

    const { columns, fieldNames } = encodeColumns(rows);
    const store = new ColumnarItemStore<Row>(columns, fieldNames, rows.length);

    expect(store.getField(0, 'tags')).toEqual(['bug', 'p0']);
    expect(store.getField(1, 'tags')).toEqual([]);
    expect(store.getField(2, 'tags')).toEqual(['feature']);
  });

  it('returns query results identical to row-form bundles', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const bytes = bundle.serialize('binary');
    const loaded = LyraBundle.loadBinary<Ticket>(bytes);

    const queries = [
      { equal: { status: 'open' } },
      { equal: { priority: ['high', 'urgent'] } },
      { equal: { status: 'open' }, ranges: { slaHours: { min: 0, max: 72 } } },
      { ranges: { slaHours: { min: 0, max: 72 } }, limit: 10 },
      { isNotNull: ['priority'] },
      { isNull: ['priority'] },
      { equal: { status: 'open' }, includeFacetCounts: true, limit: 0 },
      { notEqual: { status: 'closed' }, limit: 5 },
    ];
    for (const q of queries) {
      const original = bundle.query(q);
      const result = loaded.query(q);
      expect(result.total).toBe(original.total);
      expect(result.items.length).toBe(original.items.length);
      if (q.includeFacetCounts) {
        expect(result.facets).toEqual(original.facets);
      }
    }
  });

  it('toJSON on a columnar-loaded bundle materializes rows', async () => {
    const tickets = generateTicketArray(100);
    const original = await LyraBundle.create<Ticket>(tickets, testConfig);
    const bytes = original.serialize('binary');
    const loaded = LyraBundle.loadBinary<Ticket>(bytes);

    const json = loaded.toJSON();
    expect(json.items.length).toBe(tickets.length);
    expect(json.manifest.version).toMatch(/^4\./);

    // Round-trip back through JSON.
    const reJson: LyraBundleJSON<Ticket> = JSON.parse(JSON.stringify(json));
    const fromJson = LyraBundle.load<Ticket>(reJson);
    expect(fromJson.query({}).total).toBe(tickets.length);
  });

  it('createBundle uses RowItemStore by default', async () => {
    const tickets = generateTicketArray(10);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

    // Indirectly: toJSON should return the very same array reference (RowItemStore.materializeAll).
    const json = bundle.toJSON();
    expect(json.items).toBe(tickets);
    void RowItemStore; // touch the import for clarity
  });

  it('encodeV4 explicit json itemsFormat preserves row form', async () => {
    const tickets = generateTicketArray(50);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

    // Force row-form via the lower-level encoder.
    const bytes = encodeV4<Ticket>(
      {
        manifest: bundle.describe(),
        items: { kind: 'rows', rows: tickets },
        facetIndex: {},
        nullIndex: {},
        rangeColumns: {},
      },
      { itemsFormat: 'json' },
    );

    const decoded = decodeV4<Ticket>(bytes);
    expect(decoded.items.kind).toBe('rows');
  });
});
