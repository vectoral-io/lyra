import { describe, it, expect } from 'vitest';
import { buildOpenAiTool } from '../src';
import type { LyraManifest } from '../src';

describe('buildOpenAiTool', () => {
  const minimalManifest: LyraManifest = {
    version: '1.0.0',
    datasetId: 'test-dataset',
    builtAt: '2025-01-01T00:00:00Z',
    fields: [
      { name: 'id', kind: 'id', type: 'string', ops: ['eq'] },
      { name: 'status', kind: 'facet', type: 'string', ops: ['eq', 'in'] },
      { name: 'createdAt', kind: 'range', type: 'date', ops: ['between'] },
    ],
    capabilities: {
      facets: ['status'],
      ranges: ['createdAt'],
    },
  };

  it('should return a tool with type "function"', () => {
    const tool = buildOpenAiTool(minimalManifest, { name: 'lyraQuery' });

    expect(tool.type).toBe('function');
  });

  it('should use the provided name', () => {
    const tool = buildOpenAiTool(minimalManifest, { name: 'lyraQuery' });

    expect(tool.function.name).toBe('lyraQuery');
  });

  it('should use the provided description when given', () => {
    const customDescription = 'Query work items using facet and range filters';
    const tool = buildOpenAiTool(minimalManifest, {
      name: 'lyraQuery',
      description: customDescription,
    });

    expect(tool.function.description).toBe(customDescription);
  });

  it('should generate default description using datasetId when description is omitted', () => {
    const tool = buildOpenAiTool(minimalManifest, { name: 'lyraQuery' });

    expect(tool.function.description).toBe(
      'Query dataset "test-dataset" using facet and range filters',
    );
  });

  it('should include parameters schema with correct structure', () => {
    const tool = buildOpenAiTool(minimalManifest, { name: 'lyraQuery' });

    expect(tool.function.parameters).toBeDefined();
    const parameters = tool.function.parameters as Record<string, unknown>;

    expect(parameters.type).toBe('object');
    expect(parameters.properties).toBeDefined();
    expect(parameters.additionalProperties).toBe(false);
  });

  it('should include facets, ranges, limit, offset, and includeFacetCounts in parameters', () => {
    const tool = buildOpenAiTool(minimalManifest, { name: 'lyraQuery' });
    const parameters = tool.function.parameters as Record<string, unknown>;
    const properties = parameters.properties as Record<string, unknown>;

    expect(properties.facets).toBeDefined();
    expect(properties.ranges).toBeDefined();
    expect(properties.limit).toBeDefined();
    expect(properties.offset).toBeDefined();
    expect(properties.includeFacetCounts).toBeDefined();
  });

  it('should use single-or-array mode for facets (default)', () => {
    const tool = buildOpenAiTool(minimalManifest, { name: 'lyraQuery' });
    const parameters = tool.function.parameters as Record<string, unknown>;
    const properties = parameters.properties as Record<string, unknown>;
    const facets = properties.facets as Record<string, unknown>;
    const facetProperties = facets.properties as Record<string, unknown>;
    const statusSchema = facetProperties.status as Record<string, unknown>;

    expect(statusSchema.anyOf).toBeDefined();
    expect(Array.isArray(statusSchema.anyOf)).toBe(true);
  });

  it('should include all facet fields from manifest in parameters', () => {
    const manifest: LyraManifest = {
      version: '1.0.0',
      datasetId: 'test',
      builtAt: '2025-01-01T00:00:00Z',
      fields: [
        { name: 'id', kind: 'id', type: 'string', ops: ['eq'] },
        { name: 'status', kind: 'facet', type: 'string', ops: ['eq'] },
        { name: 'priority', kind: 'facet', type: 'string', ops: ['eq'] },
        { name: 'count', kind: 'facet', type: 'number', ops: ['eq'] },
      ],
      capabilities: {
        facets: ['status', 'priority', 'count'],
        ranges: [],
      },
    };

    const tool = buildOpenAiTool(manifest, { name: 'query' });
    const parameters = tool.function.parameters as Record<string, unknown>;
    const properties = parameters.properties as Record<string, unknown>;
    const facets = properties.facets as Record<string, unknown>;
    const facetProperties = facets.properties as Record<string, unknown>;

    expect(facetProperties.status).toBeDefined();
    expect(facetProperties.priority).toBeDefined();
    expect(facetProperties.count).toBeDefined();
  });

  it('should include all range fields from manifest in parameters', () => {
    const manifest: LyraManifest = {
      version: '1.0.0',
      datasetId: 'test',
      builtAt: '2025-01-01T00:00:00Z',
      fields: [
        { name: 'id', kind: 'id', type: 'string', ops: ['eq'] },
        { name: 'createdAt', kind: 'range', type: 'date', ops: ['between'] },
        { name: 'amount', kind: 'range', type: 'number', ops: ['between'] },
      ],
      capabilities: {
        facets: [],
        ranges: ['createdAt', 'amount'],
      },
    };

    const tool = buildOpenAiTool(manifest, { name: 'query' });
    const parameters = tool.function.parameters as Record<string, unknown>;
    const properties = parameters.properties as Record<string, unknown>;
    const ranges = properties.ranges as Record<string, unknown>;
    const rangeProperties = ranges.properties as Record<string, unknown>;

    expect(rangeProperties.createdAt).toBeDefined();
    expect(rangeProperties.amount).toBeDefined();
  });

  it('should produce a non-empty description', () => {
    const tool = buildOpenAiTool(minimalManifest, { name: 'lyraQuery' });

    expect(tool.function.description).toBeTruthy();
    expect(tool.function.description.length).toBeGreaterThan(0);
  });
});

