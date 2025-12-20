import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LyraBundle, createBundle, type SimpleBundleConfig } from '../src';

describe('LyraBundle - V2 Aliases', () => {
  it('auto-generates lookup tables from item data', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A' },
      { id: '2', zone_id: 'Z-001', zone_name: 'Zone A' },
      { id: '3', zone_id: 'Z-002', zone_name: 'Zone B' },
    ];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: {
        zone_name: 'zone_id',
      },
    };

    const bundle = await createBundle(items, config);
    const manifest = bundle.describe();

    expect(manifest.capabilities.aliases).toContain('zone_name');
    expect(manifest.lookups).toBeDefined();
    expect(manifest.lookups?.['zone_name']).toBeDefined();

    const lookup = manifest.lookups!['zone_name'];
    expect(lookup.aliasToIds['Zone A']).toEqual(['Z-001']);
    expect(lookup.aliasToIds['Zone B']).toEqual(['Z-002']);
    expect(lookup.idToAliases['Z-001']).toEqual(['Zone A']);
    expect(lookup.idToAliases['Z-002']).toEqual(['Zone B']);
  });

  it('supports many-to-many alias relationships', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A' },
      { id: '2', zone_id: 'Z-001', zone_name: 'Zone A Alt' }, // Same ID, different name
      { id: '3', zone_id: 'Z-002', zone_name: 'Zone A' }, // Same name, different ID
    ];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: {
        zone_name: 'zone_id',
      },
    };

    const bundle = await createBundle(items, config);
    const lookup = bundle.describe().lookups!['zone_name'];

    // One alias value maps to multiple IDs
    expect(lookup.aliasToIds['Zone A']).toContain('Z-001');
    expect(lookup.aliasToIds['Zone A']).toContain('Z-002');

    // One ID maps to multiple alias values
    expect(lookup.idToAliases['Z-001']).toContain('Zone A');
    expect(lookup.idToAliases['Z-001']).toContain('Zone A Alt');
  });

  it('supports multiple aliases for same canonical field', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A', zone_label: 'First Floor' },
      { id: '2', zone_id: 'Z-001', zone_name: 'Zone A', zone_label: 'First Floor' },
      { id: '3', zone_id: 'Z-002', zone_name: 'Zone B', zone_label: 'Second Floor' },
    ];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: {
        zone_name: 'zone_id',
        zone_label: 'zone_id',
      },
    };

    const bundle = await createBundle(items, config);
    const manifest = bundle.describe();

    expect(manifest.capabilities.aliases).toContain('zone_name');
    expect(manifest.capabilities.aliases).toContain('zone_label');

    // Each alias has its own lookup table
    expect(manifest.lookups?.['zone_name']).toBeDefined();
    expect(manifest.lookups?.['zone_label']).toBeDefined();

    // Query by zone_name
    const result1 = bundle.query({
      equal: { zone_name: 'Zone A' },
    });
    expect(result1.total).toBe(2);

    // Query by zone_label
    const result2 = bundle.query({
      equal: { zone_label: 'First Floor' },
    });
    expect(result2.total).toBe(2);
  });

  it('resolves aliases in queries (Option B: warn and continue)', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A' },
      { id: '2', zone_id: 'Z-002', zone_name: 'Zone B' },
    ];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: {
        zone_name: 'zone_id',
      },
    };

    const bundle = await createBundle(items, config);

    // Query with resolvable alias
    const result1 = bundle.query({
      equal: { zone_name: 'Zone A' },
    });
    expect(result1.total).toBe(1);
    expect(result1.items[0].zone_id).toBe('Z-001');

    // Query with unresolvable alias (Option B: warn and continue)
    const result2 = bundle.query({
      equal: { zone_name: ['Zone A', 'Unknown Zone'] },
    });
    expect(result2.total).toBe(1); // Still matches Zone A
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("No mapping found for zone_name='Unknown Zone'")
    );

    consoleSpy.mockRestore();
  });

  it('supports mixing canonical and alias fields in queries', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A', status: 'open' },
      { id: '2', zone_id: 'Z-001', zone_name: 'Zone A', status: 'closed' },
      { id: '3', zone_id: 'Z-002', zone_name: 'Zone B', status: 'open' },
    ];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id', 'status'],
      aliases: {
        zone_name: 'zone_id',
      },
    };

    const bundle = await createBundle(items, config);

    const result = bundle.query({
      equal: {
        zone_name: 'Zone A', // Alias
        status: 'open', // Canonical
      },
    });

    expect(result.total).toBe(1);
    expect(result.items[0].zone_id).toBe('Z-001');
    expect(result.items[0].status).toBe('open');
  });

  it('enriches results with alias values (explicit true)', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A' },
      { id: '2', zone_id: 'Z-001', zone_name: 'Zone A' },
      { id: '3', zone_id: 'Z-002', zone_name: 'Zone B' },
    ];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: {
        zone_name: 'zone_id',
      },
    };

    const bundle = await createBundle(items, config);

    // Explicitly set to true - items are enriched directly
    const result = bundle.query({
      equal: { zone_id: 'Z-001' },
      enrichAliases: true,
    });

    // Items are enriched directly
    expect(result.items[0].zone_name).toEqual(['Zone A']);
    expect(result.items[1].zone_name).toEqual(['Zone A']);
    
    // enrichedAliases is also populated for backward compatibility
    expect(result.enrichedAliases).toBeDefined();
    expect(result.enrichedAliases!.length).toBe(result.items.length);
    expect(result.enrichedAliases![0].zone_name).toEqual(['Zone A']);
  });

  it('enriches results with all available aliases when enrichAliases: true', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A', zone_label: 'First Floor' },
      { id: '2', zone_id: 'Z-002', zone_name: 'Zone B', zone_label: 'Second Floor' },
    ];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: {
        zone_name: 'zone_id',
        zone_label: 'zone_id',
      },
    };

    const bundle = await createBundle(items, config);

    // enrichAliases: true should enrich ALL available aliases
    const result = bundle.query({
      equal: { zone_id: 'Z-001' },
      enrichAliases: true,
    });

    // Both alias fields should be enriched
    expect(result.items[0].zone_name).toEqual(['Zone A']);
    expect(result.items[0].zone_label).toEqual(['First Floor']);
    
    // enrichedAliases should contain all aliases
    expect(result.enrichedAliases).toBeDefined();
    expect(result.enrichedAliases![0].zone_name).toEqual(['Zone A']);
    expect(result.enrichedAliases![0].zone_label).toEqual(['First Floor']);
  });

  it('enriches results with specific alias fields only', async () => {
    // Items with alias fields for lookup table generation
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A', zone_label: 'First Floor' },
      { id: '2', zone_id: 'Z-002', zone_name: 'Zone B', zone_label: 'Second Floor' },
    ];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: {
        zone_name: 'zone_id',
        zone_label: 'zone_id',
      },
    };

    const bundle = await createBundle(items, config);

    // Query and enrich only zone_name
    const result = bundle.query({
      equal: { zone_id: 'Z-001' },
      enrichAliases: ['zone_name'], // Only enrich zone_name
    });

    // Items are enriched directly with only requested alias field
    expect(result.items[0].zone_name).toEqual(['Zone A']);
    // zone_label is excluded from bundle items (alias fields are automatically excluded)
    expect(result.items[0].zone_label).toBeUndefined();
    
    // enrichedAliases only contains requested fields
    expect(result.enrichedAliases).toBeDefined();
    expect(result.enrichedAliases![0].zone_name).toBeDefined();
    expect(result.enrichedAliases![0].zone_name).toEqual(['Zone A']);
    // zone_label should not be in enrichedAliases since it wasn't requested
    expect(result.enrichedAliases![0].zone_label).toBeUndefined();
  });

  it('warns when alias field missing in all items', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const items = [
      { id: '1', zone_id: 'Z-001' }, // Missing zone_name
    ];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: {
        zone_name: 'zone_id',
      },
    };

    await createBundle(items, config);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('No valid pairs found')
    );

    consoleSpy.mockRestore();
  });

  it('warns when array values found in alias/target fields', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: ['Zone A'] }, // Array value
    ];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: {
        zone_name: 'zone_id',
      },
    };

    await createBundle(items, config);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Array values not supported')
    );

    consoleSpy.mockRestore();
  });

  it('handles empty strings as valid alias values', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: '' },
      { id: '2', zone_id: 'Z-002', zone_name: 'Zone B' },
    ];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: {
        zone_name: 'zone_id',
      },
    };

    const bundle = await createBundle(items, config);
    const lookup = bundle.describe().lookups!['zone_name'];

    expect(lookup.aliasToIds['']).toEqual(['Z-001']);

    const result = bundle.query({
      equal: { zone_name: '' },
    });
    expect(result.total).toBe(1);
  });

  it('defaults enrichAliases to false (opt-in)', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A' },
      { id: '2', zone_id: 'Z-002', zone_name: 'Zone B' },
    ];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: {
        zone_name: 'zone_id',
      },
    };

    const bundle = await createBundle(items, config);

    // Query without specifying enrichAliases (should default to false)
    const result = bundle.query({
      equal: { zone_id: 'Z-001' },
    });

    expect(result.enrichedAliases).toBeUndefined();

    // Explicitly set to true should enable enrichment
    const resultEnriched = bundle.query({
      equal: { zone_id: 'Z-001' },
      enrichAliases: true,
    });

    expect(resultEnriched.enrichedAliases).toBeDefined();
    expect(resultEnriched.enrichedAliases!.length).toBe(resultEnriched.items.length);
    expect(resultEnriched.enrichedAliases![0].zone_name).toEqual(['Zone A']);
  });

  it('enrichItems utility method enriches items efficiently', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A' },
      { id: '2', zone_id: 'Z-001', zone_name: 'Zone A' },
      { id: '3', zone_id: 'Z-002', zone_name: 'Zone B' },
    ];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: {
        zone_name: 'zone_id',
      },
    };

    const bundle = await createBundle(items, config);

    // Query without enrichment
    const result = bundle.query({
      equal: { zone_id: 'Z-001' },
    });

    // Use enrichItems utility
    const enriched = bundle.enrichItems(result.items, ['zone_name']);

    expect(enriched.length).toBe(2);
    expect(enriched[0].zone_name).toEqual(['Zone A']);
    expect(enriched[1].zone_name).toEqual(['Zone A']);
    expect(enriched[0].id).toBe('1'); // Original fields preserved
  });

  it('enrichItems handles multiple alias fields', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A', zone_label: 'First Floor' },
      { id: '2', zone_id: 'Z-002', zone_name: 'Zone B', zone_label: 'Second Floor' },
    ];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: {
        zone_name: 'zone_id',
        zone_label: 'zone_id',
      },
    };

    const bundle = await createBundle(items, config);

    const result = bundle.query({
      equal: { zone_id: ['Z-001', 'Z-002'] },
    });

    const enriched = bundle.enrichItems(result.items, ['zone_name', 'zone_label']);

    expect(enriched.length).toBe(2);
    expect(enriched[0].zone_name).toEqual(['Zone A']);
    expect(enriched[0].zone_label).toEqual(['First Floor']);
    expect(enriched[1].zone_name).toEqual(['Zone B']);
    expect(enriched[1].zone_label).toEqual(['Second Floor']);
  });

  it('enrichItems deduplicates IDs efficiently', async () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      id: `item-${i}`,
      zone_id: i % 10 === 0 ? 'Z-001' : 'Z-002', // Only 2 unique IDs
      zone_name: i % 10 === 0 ? 'Zone A' : 'Zone B',
    }));

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: {
        zone_name: 'zone_id',
      },
    };

    const bundle = await createBundle(items, config);

    const result = bundle.query({
      equal: { zone_id: ['Z-001', 'Z-002'] },
    });

    // Should only do 2 lookups (for 2 unique IDs) even though we have 100 items
    const enriched = bundle.enrichItems(result.items, ['zone_name']);

    expect(enriched.length).toBe(100);
    expect(enriched[0].zone_name).toEqual(['Zone A']);
    expect(enriched[10].zone_name).toEqual(['Zone A']);
    expect(enriched[1].zone_name).toEqual(['Zone B']);
  });

  it('excludes alias fields from bundle items', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A' },
    ];
    const bundle = await createBundle(items, {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: {
        zone_name: 'zone_id',
      },
    });
    
    // Alias field should not be in stored items
    expect(bundle.items[0].zone_name).toBeUndefined();
    expect(bundle.items[0].zone_id).toBe('Z-001');
    
    // But queries should still work
    const result = bundle.query({ equal: { zone_name: 'Zone A' } });
    expect(result.items.length).toBe(1);
  });

  it('respects includeFields configuration', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A', extra: 'data' },
    ];
    const bundle = await createBundle(items, {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: { zone_name: 'zone_id' },
      includeFields: ['zone_id'], // Only include zone_id
    });
    
    expect(bundle.items[0].zone_id).toBe('Z-001');
    expect(bundle.items[0].zone_name).toBeUndefined(); // Alias excluded
    expect(bundle.items[0].extra).toBeUndefined(); // Not in includeFields
    expect(bundle.items[0].id).toBe('1'); // Protected field always included
  });

  it('respects excludeFields configuration', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A', extra: 'data', meta: 'info' },
    ];
    const bundle = await createBundle(items, {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: { zone_name: 'zone_id' },
      excludeFields: ['extra'], // Exclude extra field
    });
    
    expect(bundle.items[0].zone_id).toBe('Z-001'); // Facet included
    expect(bundle.items[0].zone_name).toBeUndefined(); // Alias excluded
    expect(bundle.items[0].extra).toBeUndefined(); // Explicitly excluded
    expect(bundle.items[0].meta).toBe('info'); // Not excluded, so included
  });

  it('excludeFields takes precedence over includeFields', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', extra: 'data' },
    ];
    const bundle = await createBundle(items, {
      datasetId: 'test',
      facets: ['zone_id'],
      includeFields: ['zone_id', 'extra'],
      excludeFields: ['extra'], // Exclude takes precedence
    });
    
    expect(bundle.items[0].zone_id).toBe('Z-001');
    expect(bundle.items[0].extra).toBeUndefined(); // Excluded despite being in includeFields
  });

  it('cannot exclude protected fields (id, facets, ranges)', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', createdAt: 1234567890 },
    ];
    const bundle = await createBundle(items, {
      datasetId: 'test',
      facets: ['zone_id'],
      ranges: ['createdAt'],
      excludeFields: ['id', 'zone_id', 'createdAt'], // Try to exclude protected fields
    });
    
    // Protected fields should still be present
    expect(bundle.items[0].id).toBe('1');
    expect(bundle.items[0].zone_id).toBe('Z-001');
    expect(bundle.items[0].createdAt).toBe(1234567890);
  });
});

