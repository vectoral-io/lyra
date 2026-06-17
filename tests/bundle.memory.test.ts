import { describe, it, expect } from 'vitest';
import { LyraBundle, createBundle, type SimpleBundleConfig } from '../src';
import { generateTicketArray, type Ticket } from './tickets.fixture';
import { DATASET_SIZE, testConfig } from './test-config';

describe('dispose()', () => {
  it('releases the bundle and blocks data operations afterward', async () => {
    const tickets = generateTicketArray(200);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

    // Live before disposal.
    expect(bundle.isDisposed).toBe(false);
    expect(bundle.query({ equal: { status: 'open' } }).total).toBeGreaterThanOrEqual(0);

    bundle.dispose();

    expect(bundle.isDisposed).toBe(true);
    expect(() => bundle.query({})).toThrow(/disposed/i);
    expect(() => bundle.toJSON()).toThrow(/disposed/i);
    expect(() => bundle.serialize('binary')).toThrow(/disposed/i);
    expect(() => bundle.getFacetSummary('status')).toThrow(/disposed/i);
  });

  it('keeps metadata methods working after disposal', async () => {
    const tickets = generateTicketArray(50);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const manifestBefore = bundle.describe();

    bundle.dispose();

    expect(bundle.describe()).toEqual(manifestBefore);
    expect(bundle.snapshot().datasetId).toBe(testConfig.datasetId);
  });

  it('is idempotent', async () => {
    const tickets = generateTicketArray(10);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

    bundle.dispose();
    expect(() => bundle.dispose()).not.toThrow();
    expect(bundle.isDisposed).toBe(true);
  });

  it('disposes a binary-loaded bundle without touching undecoded columns', async () => {
    const tickets = generateTicketArray(100);
    const source = await LyraBundle.create<Ticket>(tickets, testConfig);
    const loaded = LyraBundle.loadBinary<Ticket>(source.serialize('binary'));

    // Dispose before any query forces column hydration — must not throw.
    expect(() => loaded.dispose()).not.toThrow();
    expect(() => loaded.query({})).toThrow(/disposed/i);
  });
});

describe('lazy columnar hydration', () => {
  it('produces query results identical to the in-memory bundle', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const loaded = LyraBundle.loadBinary<Ticket>(bundle.serialize('binary'));

    const queries = [
      { equal: { status: 'open' }, limit: 25 },
      { equal: { priority: ['high', 'urgent'] }, limit: 25 },
      { ranges: { slaHours: { min: 0, max: 24 } }, limit: 25 },
      { isNotNull: ['priority'], limit: 25 },
    ];
    for (const q of queries) {
      const expected = bundle.query(q);
      const actual = loaded.query(q);
      expect(actual.total).toBe(expected.total);
      expect(actual.items).toEqual(expected.items);
    }
  });

  it('hydrates only the columns a query reads, then serves the rest on demand', async () => {
    const tickets = generateTicketArray(300);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const loaded = LyraBundle.loadBinary<Ticket>(bundle.serialize('binary'));

    // First query touches a narrow projection — only those columns decode.
    const narrow = loaded.query({ equal: { status: 'open' }, select: ['id', 'status'], limit: 5 });
    expect(narrow.items.every((row) => row.status === 'open')).toBe(true);

    // A later query reading other columns must still hydrate them correctly.
    const wide = loaded.query({ equal: { status: 'open' }, limit: 5 });
    expect(wide.items[0]).toHaveProperty('region');
    expect(wide.items[0]).toHaveProperty('slaHours');
  });

  it('re-serializes a lazily-loaded bundle by resolving all columns', async () => {
    const tickets = generateTicketArray(120);
    const source = await LyraBundle.create<Ticket>(tickets, testConfig);
    const loaded = LyraBundle.loadBinary<Ticket>(source.serialize('binary'));

    // toJSON must materialize every row even though no query forced hydration.
    const json = loaded.toJSON();
    expect(json.items.length).toBe(tickets.length);

    // Round-trip the re-serialized binary form too.
    const reloaded = LyraBundle.loadBinary<Ticket>(loaded.serialize('binary'));
    expect(reloaded.query({}).total).toBe(tickets.length);
  });
});

describe('query projection (select)', () => {
  it('returns only the requested fields on a row-loaded bundle', async () => {
    const tickets = generateTicketArray(100);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

    const result = bundle.query({ equal: { status: 'open' }, select: ['id', 'priority'], limit: 10 });
    expect(result.items.length).toBeGreaterThan(0);
    for (const row of result.items) {
      expect(Object.keys(row).sort()).toEqual(['id', 'priority']);
    }
  });

  it('returns only the requested fields on a columnar-loaded bundle', async () => {
    const tickets = generateTicketArray(100);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);
    const loaded = LyraBundle.loadBinary<Ticket>(bundle.serialize('binary'));

    const result = loaded.query({ select: ['id', 'region'], limit: 10 });
    for (const row of result.items) {
      expect(Object.keys(row).sort()).toEqual(['id', 'region']);
    }
  });

  it('does not affect total or facet counts', async () => {
    const tickets = generateTicketArray(500);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

    const full = bundle.query({ equal: { status: 'open' }, includeFacetCounts: true, limit: 5 });
    const projected = bundle.query({
      equal: { status: 'open' },
      includeFacetCounts: true,
      limit: 5,
      select: ['id'],
    });

    expect(projected.total).toBe(full.total);
    expect(projected.facets).toEqual(full.facets);
  });

  it('omits missing/undefined fields rather than emitting undefined keys', async () => {
    const tickets = generateTicketArray(20);
    const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

    const result = bundle.query({ select: ['id', 'nonexistent_field'], limit: 5 });
    for (const row of result.items) {
      expect(Object.keys(row)).toEqual(['id']);
    }
  });

  it('still enriches aliases when the canonical field is selected', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A' },
      { id: '2', zone_id: 'Z-002', zone_name: 'Zone B' },
    ];
    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'zones',
      facets: ['zone_id'],
      aliases: { zone_name: 'zone_id' },
    };
    const bundle = await createBundle(items, config);

    // Canonical field present → enrichment resolves.
    const ok = bundle.query({ select: ['id', 'zone_id'], enrichAliases: ['zone_name'] });
    expect((ok.items[0] as Record<string, unknown>).zone_name).toEqual(['Zone A']);

    // Canonical field projected out → nothing to resolve against.
    const missing = bundle.query({ select: ['id'], enrichAliases: ['zone_name'] });
    expect((missing.items[0] as Record<string, unknown>).zone_name).toBeUndefined();
  });
});
