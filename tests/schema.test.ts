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
    expect(properties.equal).toBeDefined();
    expect(properties.notEqual).toBeDefined();
    expect(properties.ranges).toBeDefined();
    expect(properties.isNull).toBeDefined();
    expect(properties.isNotNull).toBeDefined();
    expect(properties.limit).toBeDefined();
    expect(properties.offset).toBeDefined();
    expect(properties.includeFacetCounts).toBeDefined();
  });

  it('should include all facet fields under equal.properties', () => {
    const schema = buildQuerySchema(testManifest);
    const properties = schema.properties as Record<string, unknown>;
    const equal = properties.equal as Record<string, unknown>;
    const equalProperties = equal.properties as Record<string, unknown>;

    expect(equalProperties.customerId).toBeDefined();
    expect(equalProperties.priority).toBeDefined();
    expect(equalProperties.status).toBeDefined();
    expect(equalProperties.productArea).toBeDefined();
    expect(equalProperties.region).toBeDefined();
    expect(equalProperties.isActive).toBeDefined();
    expect(equalProperties.count).toBeDefined();
    expect(equalProperties.createdAt).toBeUndefined(); // Should not be in equal
    expect(equalProperties.slaHours).toBeUndefined(); // Should not be in equal
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

  it('should use anyOf for equal fields (scalar or array)', () => {
    const schema = buildQuerySchema(testManifest);
    const properties = schema.properties as Record<string, unknown>;
    const equal = properties.equal as Record<string, unknown>;
    const equalProperties = equal.properties as Record<string, unknown>;
    const customerIdSchema = equalProperties.customerId as Record<string, unknown>;

    expect(customerIdSchema.anyOf).toBeDefined();
    expect(Array.isArray(customerIdSchema.anyOf)).toBe(true);

    const anyOf = customerIdSchema.anyOf as Array<Record<string, unknown>>;
    // Should support string, null, or array of string/null
    expect(anyOf.length).toBeGreaterThanOrEqual(2);
  });

  it('should support scalar or array types for equal fields', () => {
    const schema = buildQuerySchema(testManifest);
    const properties = schema.properties as Record<string, unknown>;
    const equal = properties.equal as Record<string, unknown>;
    const equalProperties = equal.properties as Record<string, unknown>;
    const customerIdSchema = equalProperties.customerId as Record<string, unknown>;

    // v2 always supports scalar or array via anyOf
    expect(customerIdSchema.anyOf).toBeDefined();
  });

  it('should correctly map equal field types', () => {
    const schema = buildQuerySchema(testManifest);
    const properties = schema.properties as Record<string, unknown>;
    const equal = properties.equal as Record<string, unknown>;
    const equalProperties = equal.properties as Record<string, unknown>;

    // All equal fields use anyOf with type, null, and array variants
    const customerIdSchema = equalProperties.customerId as Record<string, unknown>;
    expect(customerIdSchema.anyOf).toBeDefined();
    
    const isActiveSchema = equalProperties.isActive as Record<string, unknown>;
    expect(isActiveSchema.anyOf).toBeDefined();
    
    const countSchema = equalProperties.count as Record<string, unknown>;
    expect(countSchema.anyOf).toBeDefined();
  });

  it('should correctly map equal field types in anyOf mode', () => {
    const schema = buildQuerySchema(testManifest);
    const properties = schema.properties as Record<string, unknown>;
    const equal = properties.equal as Record<string, unknown>;
    const equalProperties = equal.properties as Record<string, unknown>;

    const stringEqual = equalProperties.customerId as Record<string, unknown>;
    const anyOfString = stringEqual.anyOf as Array<Record<string, unknown>>;
    expect(anyOfString.some(s => s.type === 'string')).toBe(true);
    expect(anyOfString.some(s => s.type === 'array')).toBe(true);

    const booleanEqual = equalProperties.isActive as Record<string, unknown>;
    const anyOfBoolean = booleanEqual.anyOf as Array<Record<string, unknown>>;
    expect(anyOfBoolean.some(s => s.type === 'boolean')).toBe(true);
    expect(anyOfBoolean.some(s => s.type === 'array')).toBe(true);

    const numberEqual = equalProperties.count as Record<string, unknown>;
    const anyOfNumber = numberEqual.anyOf as Array<Record<string, unknown>>;
    expect(anyOfNumber.some(s => s.type === 'number')).toBe(true);
    expect(anyOfNumber.some(s => s.type === 'array')).toBe(true);
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

  it('should set additionalProperties: false on equal, notEqual, and ranges', () => {
    const schema = buildQuerySchema(testManifest);
    const properties = schema.properties as Record<string, unknown>;
    const equal = properties.equal as Record<string, unknown>;
    const notEqual = properties.notEqual as Record<string, unknown>;
    const ranges = properties.ranges as Record<string, unknown>;

    expect(equal.additionalProperties).toBe(false);
    expect(notEqual.additionalProperties).toBe(false);
    expect(ranges.additionalProperties).toBe(false);
  });

  it('should include correct descriptions for top-level properties', () => {
    const schema = buildQuerySchema(testManifest);
    const properties = schema.properties as Record<string, unknown>;

    expect((properties.equal as Record<string, unknown>).description).toBe(
      'Equality filters (exact match or IN semantics)',
    );
    expect((properties.notEqual as Record<string, unknown>).description).toBe(
      'Inequality filters (NOT equal or NOT IN)',
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

    // Create a valid LyraQuery object (v2)
    const query: LyraQuery = {
      equal: {
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
    expect(properties.equal).toBeDefined();
    expect(properties.notEqual).toBeDefined();
    expect(properties.ranges).toBeDefined();
    expect(properties.isNull).toBeDefined();
    expect(properties.isNotNull).toBeDefined();
    expect(properties.limit).toBeDefined();
    expect(properties.offset).toBeDefined();
    expect(properties.includeFacetCounts).toBeDefined();

    // Verify equal structure
    const equal = properties.equal as Record<string, unknown>;
    const equalProperties = equal.properties as Record<string, unknown>;
    expect(equalProperties.customerId).toBeDefined();
    expect(equalProperties.priority).toBeDefined();
    expect(equalProperties.status).toBeDefined();
    expect(equalProperties.isActive).toBeDefined();
    expect(equalProperties.count).toBeDefined();

    // Verify ranges structure
    const ranges = properties.ranges as Record<string, unknown>;
    const rangeProperties = ranges.properties as Record<string, unknown>;
    expect(rangeProperties.createdAt).toBeDefined();
    expect(rangeProperties.slaHours).toBeDefined();
  });

  it('should handle manifest with no facet fields', () => {
    const manifest: LyraManifest = {
      version: '2.0.0',
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
    const equal = properties.equal as Record<string, unknown>;
    const equalProperties = equal.properties as Record<string, unknown>;

    expect(Object.keys(equalProperties)).toHaveLength(0);
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

  it('should exclude facet fields not listed in capabilities.facets', () => {
    const manifest: LyraManifest = {
      version: '2.0.0',
      datasetId: 'test',
      builtAt: '2025-01-01T00:00:00Z',
      fields: [
        { name: 'id', kind: 'id', type: 'string', ops: ['eq'] },
        { name: 'status', kind: 'facet', type: 'string', ops: ['eq'] },
        { name: 'excludedFacet', kind: 'facet', type: 'string', ops: ['eq'] },
      ],
      capabilities: {
        facets: ['status'], // excludedFacet is not in capabilities
        ranges: [],
      },
    };

    const schema = buildQuerySchema(manifest);
    const properties = schema.properties as Record<string, unknown>;
    const equal = properties.equal as Record<string, unknown>;
    const equalProperties = equal.properties as Record<string, unknown>;

    expect(equalProperties.status).toBeDefined();
    expect(equalProperties.excludedFacet).toBeUndefined();
  });

  it('should exclude range fields not listed in capabilities.ranges', () => {
    const manifest: LyraManifest = {
      version: '1.0.0',
      datasetId: 'test',
      builtAt: '2025-01-01T00:00:00Z',
      fields: [
        { name: 'id', kind: 'id', type: 'string', ops: ['eq'] },
        { name: 'createdAt', kind: 'range', type: 'date', ops: ['between'] },
        { name: 'excludedRange', kind: 'range', type: 'number', ops: ['between'] },
      ],
      capabilities: {
        facets: [],
        ranges: ['createdAt'], // excludedRange is not in capabilities
      },
    };

    const schema = buildQuerySchema(manifest);
    const properties = schema.properties as Record<string, unknown>;
    const ranges = properties.ranges as Record<string, unknown>;
    const rangeProperties = ranges.properties as Record<string, unknown>;

    expect(rangeProperties.createdAt).toBeDefined();
    expect(rangeProperties.excludedRange).toBeUndefined();
  });

  // Note: Array query format (facetMode/rangeMode) was removed in v2
  // These tests are skipped as they test deprecated functionality
  it.skip('should support array query format when includeArrayQueryFormat is true', () => {
    // Array query format removed in v2
  });

  it('should not include facetMode/rangeMode (removed in v2)', () => {
    const schema = buildQuerySchema(testManifest);
    const properties = schema.properties as Record<string, unknown>;

    expect(properties.facetMode).toBeUndefined();
    expect(properties.rangeMode).toBeUndefined();

    // equal, notEqual, and ranges should be simple objects
    const equal = properties.equal as Record<string, unknown>;
    expect(equal.type).toBe('object');
    expect(equal.anyOf).toBeUndefined();

    const ranges = properties.ranges as Record<string, unknown>;
    expect(ranges.type).toBe('object');
    expect(ranges.anyOf).toBeUndefined();
  });

  it.skip('should include array schema for facets when includeArrayQueryFormat is true', () => {
    // Array query format removed in v2
    const schema = buildQuerySchema(testManifest, { includeArrayQueryFormat: true });
    const properties = schema.properties as Record<string, unknown>;
    const equal = properties.equal as Record<string, unknown>;
    const anyOf = facets.anyOf as Array<Record<string, unknown>>;

    expect(anyOf).toHaveLength(2);

    // First option: single object
    const objectOption = anyOf[0];
    expect(objectOption.type).toBe('object');
    expect(objectOption.properties).toBeDefined();

    // Second option: array of objects
    const arrayOption = anyOf[1];
    expect(arrayOption.type).toBe('array');
    expect(arrayOption.items).toBeDefined();

    const arrayItems = arrayOption.items as Record<string, unknown>;
    expect(arrayItems.type).toBe('object');
    expect(arrayItems.properties).toBeDefined();
  });
});

