import { describe, it, expect } from 'vitest';
import { buildQuerySchema, type JsonSchema } from '../src';
import type { LyraManifest, LyraQuery } from '../src';

describe('buildQuerySchema', () => {
  // Create a test manifest similar to ticket example
  const testManifest: LyraManifest = {
    version: '1.0.0',
    datasetId: 'tickets-2025-11-22',
    builtAt: '2025-11-22T00:00:00Z',
    fields: [
      { name: 'id', kind: 'id', type: 'string', ops: ['eq'] },
      { name: 'customerId', kind: 'facet', type: 'string', ops: ['eq', 'in'] },
      { name: 'priority', kind: 'facet', type: 'string', ops: ['eq', 'in'] },
      { name: 'status', kind: 'facet', type: 'string', ops: ['eq', 'in'] },
      { name: 'productArea', kind: 'facet', type: 'string', ops: ['eq', 'in'] },
      { name: 'region', kind: 'facet', type: 'string', ops: ['eq', 'in'] },
      { name: 'isActive', kind: 'facet', type: 'boolean', ops: ['eq'] },
      { name: 'count', kind: 'facet', type: 'number', ops: ['eq', 'in'] },
      { name: 'createdAt', kind: 'range', type: 'date', ops: ['between', 'gte', 'lte'] },
      { name: 'slaHours', kind: 'range', type: 'number', ops: ['between', 'gte', 'lte'] },
      { name: 'meta', kind: 'meta', type: 'string', ops: [] },
    ],
    capabilities: {
      facets: ['customerId', 'priority', 'status', 'productArea', 'region', 'isActive', 'count'],
      ranges: ['createdAt', 'slaHours'],
    },
  };

  it('should generate a schema with correct top-level structure', () => {
    const schema = buildQuerySchema(testManifest);

    expect(schema.type).toBe('object');
    expect(schema.properties).toBeDefined();
    expect(schema.additionalProperties).toBe(false);

    const properties = schema.properties as Record<string, unknown>;
    expect(properties.facets).toBeDefined();
    expect(properties.ranges).toBeDefined();
    expect(properties.limit).toBeDefined();
    expect(properties.offset).toBeDefined();
    expect(properties.includeFacetCounts).toBeDefined();
  });

  it('should include all facet fields under facets.properties', () => {
    const schema = buildQuerySchema(testManifest);
    const properties = schema.properties as Record<string, unknown>;
    const facets = properties.facets as Record<string, unknown>;
    const facetProperties = facets.properties as Record<string, unknown>;

    expect(facetProperties.customerId).toBeDefined();
    expect(facetProperties.priority).toBeDefined();
    expect(facetProperties.status).toBeDefined();
    expect(facetProperties.productArea).toBeDefined();
    expect(facetProperties.region).toBeDefined();
    expect(facetProperties.isActive).toBeDefined();
    expect(facetProperties.count).toBeDefined();
    expect(facetProperties.createdAt).toBeUndefined(); // Should not be in facets
    expect(facetProperties.slaHours).toBeUndefined(); // Should not be in facets
  });

  it('should include all range fields under ranges.properties', () => {
    const schema = buildQuerySchema(testManifest);
    const properties = schema.properties as Record<string, unknown>;
    const ranges = properties.ranges as Record<string, unknown>;
    const rangeProperties = ranges.properties as Record<string, unknown>;

    expect(rangeProperties.createdAt).toBeDefined();
    expect(rangeProperties.slaHours).toBeDefined();
    expect(rangeProperties.customerId).toBeUndefined(); // Should not be in ranges
    expect(rangeProperties.priority).toBeUndefined(); // Should not be in ranges
  });

  it('should use anyOf for facets when facetArrayMode is single-or-array (default)', () => {
    const schema = buildQuerySchema(testManifest);
    const properties = schema.properties as Record<string, unknown>;
    const facets = properties.facets as Record<string, unknown>;
    const facetProperties = facets.properties as Record<string, unknown>;
    const customerIdSchema = facetProperties.customerId as Record<string, unknown>;

    expect(customerIdSchema.anyOf).toBeDefined();
    expect(Array.isArray(customerIdSchema.anyOf)).toBe(true);

    const anyOf = customerIdSchema.anyOf as Array<Record<string, unknown>>;
    expect(anyOf).toHaveLength(2);
    expect(anyOf[0]).toEqual({ type: 'string' });
    expect(anyOf[1]).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('should use single type for facets when facetArrayMode is single', () => {
    const schema = buildQuerySchema(testManifest, { facetArrayMode: 'single' });
    const properties = schema.properties as Record<string, unknown>;
    const facets = properties.facets as Record<string, unknown>;
    const facetProperties = facets.properties as Record<string, unknown>;
    const customerIdSchema = facetProperties.customerId as Record<string, unknown>;

    expect(customerIdSchema.type).toBe('string');
    expect(customerIdSchema.anyOf).toBeUndefined();
  });

  it('should correctly map facet field types', () => {
    const schema = buildQuerySchema(testManifest, { facetArrayMode: 'single' });
    const properties = schema.properties as Record<string, unknown>;
    const facets = properties.facets as Record<string, unknown>;
    const facetProperties = facets.properties as Record<string, unknown>;

    expect((facetProperties.customerId as Record<string, unknown>).type).toBe('string');
    expect((facetProperties.isActive as Record<string, unknown>).type).toBe('boolean');
    expect((facetProperties.count as Record<string, unknown>).type).toBe('number');
  });

  it('should correctly map facet field types in anyOf mode', () => {
    const schema = buildQuerySchema(testManifest);
    const properties = schema.properties as Record<string, unknown>;
    const facets = properties.facets as Record<string, unknown>;
    const facetProperties = facets.properties as Record<string, unknown>;

    const stringFacet = facetProperties.customerId as Record<string, unknown>;
    const anyOfString = stringFacet.anyOf as Array<Record<string, unknown>>;
    expect(anyOfString[0].type).toBe('string');
    expect(anyOfString[1]).toEqual({ type: 'array', items: { type: 'string' } });

    const booleanFacet = facetProperties.isActive as Record<string, unknown>;
    const anyOfBoolean = booleanFacet.anyOf as Array<Record<string, unknown>>;
    expect(anyOfBoolean[0].type).toBe('boolean');
    expect(anyOfBoolean[1]).toEqual({ type: 'array', items: { type: 'boolean' } });

    const numberFacet = facetProperties.count as Record<string, unknown>;
    const anyOfNumber = numberFacet.anyOf as Array<Record<string, unknown>>;
    expect(anyOfNumber[0].type).toBe('number');
    expect(anyOfNumber[1]).toEqual({ type: 'array', items: { type: 'number' } });
  });

  it('should create range properties with min/max structure', () => {
    const schema = buildQuerySchema(testManifest);
    const properties = schema.properties as Record<string, unknown>;
    const ranges = properties.ranges as Record<string, unknown>;
    const rangeProperties = ranges.properties as Record<string, unknown>;
    const createdAtSchema = rangeProperties.createdAt as Record<string, unknown>;

    expect(createdAtSchema.type).toBe('object');
    expect(createdAtSchema.additionalProperties).toBe(false);
    expect(createdAtSchema.properties).toBeDefined();

    const rangeProps = createdAtSchema.properties as Record<string, unknown>;
    expect(rangeProps.min).toBeDefined();
    expect(rangeProps.max).toBeDefined();

    const minSchema = rangeProps.min as Record<string, unknown>;
    const maxSchema = rangeProps.max as Record<string, unknown>;

    expect(minSchema.type).toBe('number');
    expect(minSchema.description).toBe('Minimum value (inclusive)');
    expect(maxSchema.type).toBe('number');
    expect(maxSchema.description).toBe('Maximum value (inclusive)');
  });

  it('should use correct description for date range fields', () => {
    const schema = buildQuerySchema(testManifest);
    const properties = schema.properties as Record<string, unknown>;
    const ranges = properties.ranges as Record<string, unknown>;
    const rangeProperties = ranges.properties as Record<string, unknown>;
    const createdAtSchema = rangeProperties.createdAt as Record<string, unknown>;

    expect(createdAtSchema.description).toBe('min/max as Unix ms');
  });

  it('should use correct description for numeric range fields', () => {
    const schema = buildQuerySchema(testManifest);
    const properties = schema.properties as Record<string, unknown>;
    const ranges = properties.ranges as Record<string, unknown>;
    const rangeProperties = ranges.properties as Record<string, unknown>;
    const slaHoursSchema = rangeProperties.slaHours as Record<string, unknown>;

    expect(slaHoursSchema.description).toBe('numeric range');
  });

  it('should set additionalProperties: false on facets and ranges', () => {
    const schema = buildQuerySchema(testManifest);
    const properties = schema.properties as Record<string, unknown>;
    const facets = properties.facets as Record<string, unknown>;
    const ranges = properties.ranges as Record<string, unknown>;

    expect(facets.additionalProperties).toBe(false);
    expect(ranges.additionalProperties).toBe(false);
  });

  it('should include correct descriptions for top-level properties', () => {
    const schema = buildQuerySchema(testManifest);
    const properties = schema.properties as Record<string, unknown>;

    expect((properties.facets as Record<string, unknown>).description).toBe(
      'Facet filters (equality matching)',
    );
    expect((properties.ranges as Record<string, unknown>).description).toBe(
      'Range filters (min/max bounds per field)',
    );
    expect((properties.limit as Record<string, unknown>).description).toBe(
      'Maximum number of results to return',
    );
    expect((properties.offset as Record<string, unknown>).description).toBe(
      'Number of results to skip (for pagination)',
    );
    expect((properties.includeFacetCounts as Record<string, unknown>).description).toBe(
      'Include facet counts in the response',
    );
  });

  it('should generate schema compatible with LyraQuery type', () => {
    const schema = buildQuerySchema(testManifest);

    // Create a valid LyraQuery object
    const query: LyraQuery = {
      facets: {
        customerId: 'customer-123',
        priority: ['high', 'medium'],
        status: 'open',
        isActive: true,
        count: 42,
      },
      ranges: {
        createdAt: { min: 1000, max: 2000 },
        slaHours: { min: 24 },
      },
      limit: 10,
      offset: 0,
      includeFacetCounts: true,
    };

    // Verify that the query structure matches the schema
    // This is a structural compatibility check
    const properties = schema.properties as Record<string, unknown>;
    expect(properties.facets).toBeDefined();
    expect(properties.ranges).toBeDefined();
    expect(properties.limit).toBeDefined();
    expect(properties.offset).toBeDefined();
    expect(properties.includeFacetCounts).toBeDefined();

    // Verify facets structure
    const facets = properties.facets as Record<string, unknown>;
    const facetProperties = facets.properties as Record<string, unknown>;
    expect(facetProperties.customerId).toBeDefined();
    expect(facetProperties.priority).toBeDefined();
    expect(facetProperties.status).toBeDefined();
    expect(facetProperties.isActive).toBeDefined();
    expect(facetProperties.count).toBeDefined();

    // Verify ranges structure
    const ranges = properties.ranges as Record<string, unknown>;
    const rangeProperties = ranges.properties as Record<string, unknown>;
    expect(rangeProperties.createdAt).toBeDefined();
    expect(rangeProperties.slaHours).toBeDefined();
  });

  it('should handle manifest with no facet fields', () => {
    const manifest: LyraManifest = {
      version: '1.0.0',
      datasetId: 'test',
      builtAt: '2025-01-01T00:00:00Z',
      fields: [
        { name: 'id', kind: 'id', type: 'string', ops: ['eq'] },
        { name: 'value', kind: 'range', type: 'number', ops: ['between'] },
      ],
      capabilities: {
        facets: [],
        ranges: ['value'],
      },
    };

    const schema = buildQuerySchema(manifest);
    const properties = schema.properties as Record<string, unknown>;
    const facets = properties.facets as Record<string, unknown>;
    const facetProperties = facets.properties as Record<string, unknown>;

    expect(Object.keys(facetProperties)).toHaveLength(0);
  });

  it('should handle manifest with no range fields', () => {
    const manifest: LyraManifest = {
      version: '1.0.0',
      datasetId: 'test',
      builtAt: '2025-01-01T00:00:00Z',
      fields: [
        { name: 'id', kind: 'id', type: 'string', ops: ['eq'] },
        { name: 'status', kind: 'facet', type: 'string', ops: ['eq'] },
      ],
      capabilities: {
        facets: ['status'],
        ranges: [],
      },
    };

    const schema = buildQuerySchema(manifest);
    const properties = schema.properties as Record<string, unknown>;
    const ranges = properties.ranges as Record<string, unknown>;
    const rangeProperties = ranges.properties as Record<string, unknown>;

    expect(Object.keys(rangeProperties)).toHaveLength(0);
  });
});

