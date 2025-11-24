import { describe, it, expect } from 'vitest';
import { LyraBundle, type CreateBundleConfig } from '../src';
import { generateTicketArray, type Ticket } from './tickets.fixture';
import { testConfig } from './test-config';


describe('LyraBundle - Multi-Valued Facets', () => {
  const config = testConfig;


  it('handles empty arrays in facet fields', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], tags: [] },
      { ...generateTicketArray(1)[0], tags: ['tag1'] },
      { ...generateTicketArray(1)[0], tags: ['tag2', 'tag3'] },
    ];
    const configWithTags: CreateBundleConfig<Ticket> = {
      datasetId: 'test',
      fields: {
        id: { kind: 'id', type: 'string' },
        tags: { kind: 'facet', type: 'string' },
      },
    };
    const bundle = await LyraBundle.create<Ticket>(tickets, configWithTags);

    // Empty arrays should be skipped (like null)
    const result = bundle.query({ facets: { tags: 'tag1' } });
    expect(result.total).toBe(1);
    expect(result.items[0]?.tags).toContain('tag1');
  });


  it('handles arrays with null or undefined elements', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], tags: ['tag1', null as any, 'tag2'] },
      { ...generateTicketArray(1)[0], tags: ['tag3', undefined as any] },
      { ...generateTicketArray(1)[0], tags: ['tag1'] },
    ];
    const configWithTags: CreateBundleConfig<Ticket> = {
      datasetId: 'test',
      fields: {
        id: { kind: 'id', type: 'string' },
        tags: { kind: 'facet', type: 'string' },
      },
    };
    const bundle = await LyraBundle.create<Ticket>(tickets, configWithTags);

    // Null/undefined elements should be converted to strings and indexed
    const result = bundle.query({ facets: { tags: 'tag1' } });
    expect(result.total).toBe(2); // Both items with tag1
  });


  it('handles arrays with duplicate values correctly', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], tags: ['tag1', 'tag1', 'tag2'] },
      { ...generateTicketArray(1)[0], tags: ['tag1'] },
    ];
    const configWithTags: CreateBundleConfig<Ticket> = {
      datasetId: 'test',
      fields: {
        id: { kind: 'id', type: 'string' },
        tags: { kind: 'facet', type: 'string' },
      },
    };
    const bundle = await LyraBundle.create<Ticket>(tickets, configWithTags);

    // Both items should match tag1
    const result = bundle.query({ facets: { tags: 'tag1' } });
    expect(result.total).toBe(2);

    // Facet counts should count each occurrence
    const resultWithCounts = bundle.query({
      facets: { tags: 'tag1' },
      includeFacetCounts: true,
    });
    expect(resultWithCounts.facets?.tags['tag1']).toBe(3); // 2 + 1
  });


  it('handles arrays with mixed types', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], tags: ['string', 123, true] as any },
      { ...generateTicketArray(1)[0], tags: ['string'] },
    ];
    const configWithTags: CreateBundleConfig<Ticket> = {
      datasetId: 'test',
      fields: {
        id: { kind: 'id', type: 'string' },
        tags: { kind: 'facet', type: 'string' },
      },
    };
    const bundle = await LyraBundle.create<Ticket>(tickets, configWithTags);

    // All values should be converted to strings
    const stringResult = bundle.query({ facets: { tags: 'string' } });
    expect(stringResult.total).toBe(2);

    const numberResult = bundle.query({ facets: { tags: '123' } });
    expect(numberResult.total).toBe(1);

    const boolResult = bundle.query({ facets: { tags: 'true' } });
    expect(boolResult.total).toBe(1);
  });


  it('handles very large arrays in facet fields', async () => {
    const largeArray = Array.from({ length: 150 }, (_, i) => `tag${i}`);
    const tickets = [
      { ...generateTicketArray(1)[0], tags: largeArray },
      { ...generateTicketArray(1)[0], tags: ['tag0'] },
    ];
    const configWithTags: CreateBundleConfig<Ticket> = {
      datasetId: 'test',
      fields: {
        id: { kind: 'id', type: 'string' },
        tags: { kind: 'facet', type: 'string' },
      },
    };
    const bundle = await LyraBundle.create<Ticket>(tickets, configWithTags);

    // Should handle large arrays
    const result = bundle.query({ facets: { tags: 'tag0' } });
    expect(result.total).toBe(2);

    const result149 = bundle.query({ facets: { tags: 'tag149' } });
    expect(result149.total).toBe(1);
  });


  it('handles nested arrays gracefully', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], tags: [['nested'] as any] as any },
      { ...generateTicketArray(1)[0], tags: ['normal'] },
    ];
    const configWithTags: CreateBundleConfig<Ticket> = {
      datasetId: 'test',
      fields: {
        id: { kind: 'id', type: 'string' },
        tags: { kind: 'facet', type: 'string' },
      },
    };
    const bundle = await LyraBundle.create<Ticket>(tickets, configWithTags);

    // Nested arrays should be converted to strings
    const result = bundle.query({ facets: { tags: 'normal' } });
    expect(result.total).toBe(1);
  });


  it('handles arrays with empty strings', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], tags: ['', 'tag1', ''] },
      { ...generateTicketArray(1)[0], tags: ['tag1'] },
    ];
    const configWithTags: CreateBundleConfig<Ticket> = {
      datasetId: 'test',
      fields: {
        id: { kind: 'id', type: 'string' },
        tags: { kind: 'facet', type: 'string' },
      },
    };
    const bundle = await LyraBundle.create<Ticket>(tickets, configWithTags);

    // Empty strings should be indexed
    const emptyResult = bundle.query({ facets: { tags: '' } });
    expect(emptyResult.total).toBe(1);

    const tag1Result = bundle.query({ facets: { tags: 'tag1' } });
    expect(tag1Result.total).toBe(2);
  });


  it('handles querying with empty array in facet filter', async () => {
    const tickets = generateTicketArray(100);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Empty array should return no matches
    const result = bundle.query({ facets: { status: [] as any } });

    expect(result.total).toBe(0);
    expect(result.items.length).toBe(0);
  });


  it('handles querying with array containing null/undefined', async () => {
    const tickets = generateTicketArray(100);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const sampleStatus = tickets[0]?.status;
    if (sampleStatus) {
      // Array with null/undefined should convert to strings
      const result = bundle.query({
        facets: { status: [sampleStatus, null as any, undefined as any] },
      });

      // Should match items with the actual status value
      const expected = tickets.filter((t) => t.status === sampleStatus);
      expect(result.total).toBe(expected.length);
    }
  });


  it('handles querying with array containing duplicates', async () => {
    const tickets = generateTicketArray(100);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const sampleStatus = tickets[0]?.status;
    if (sampleStatus) {
      // Duplicates in query should work (union semantics)
      const result = bundle.query({
        facets: { status: [sampleStatus, sampleStatus, sampleStatus] },
      });

      const expected = tickets.filter((t) => t.status === sampleStatus);
      expect(result.total).toBe(expected.length);
    }
  });


  it('computes facet counts correctly for multi-valued facets', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], tags: ['tag1', 'tag2'] },
      { ...generateTicketArray(1)[0], tags: ['tag1', 'tag3'] },
      { ...generateTicketArray(1)[0], tags: ['tag2'] },
    ];
    const configWithTags: CreateBundleConfig<Ticket> = {
      datasetId: 'test',
      fields: {
        id: { kind: 'id', type: 'string' },
        tags: { kind: 'facet', type: 'string' },
      },
    };
    const bundle = await LyraBundle.create<Ticket>(tickets, configWithTags);

    const result = bundle.query({ includeFacetCounts: true });

    expect(result.facets?.tags['tag1']).toBe(2);
    expect(result.facets?.tags['tag2']).toBe(2);
    expect(result.facets?.tags['tag3']).toBe(1);
  });


  it('excludes null/undefined values from facet counts', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], status: 'open' },
      { ...generateTicketArray(1)[0], status: null as any },
      { ...generateTicketArray(1)[0], status: undefined as any },
      { ...generateTicketArray(1)[0], status: 'closed' },
    ];
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({ includeFacetCounts: true });

    expect(result.facets?.status['open']).toBe(1);
    expect(result.facets?.status['closed']).toBe(1);
    // Null/undefined should not appear in counts
    expect(result.facets?.status['null']).toBeUndefined();
    expect(result.facets?.status['undefined']).toBeUndefined();
  });
});

