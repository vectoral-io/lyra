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

    // Explicitly set to true (should work the same as default)
    const result = bundle.query({
      equal: { zone_id: 'Z-001' },
      enrichAliases: true,
    });

    expect(result.enrichedAliases).toBeDefined();
    expect(result.enrichedAliases!.length).toBe(result.items.length);

    for (const enriched of result.enrichedAliases!) {
      expect(enriched.zone_name).toEqual(['Zone A']);
    }
  });

  it('enriches results with specific alias fields only', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A', zone_label: 'First Floor' },
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
      equal: { zone_id: 'Z-001' },
      enrichAliases: ['zone_name'], // Only enrich zone_name
    });

    expect(result.enrichedAliases).toBeDefined();
    expect(result.enrichedAliases![0].zone_name).toBeDefined();
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

  it('defaults enrichAliases to true when aliases are available', async () => {
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

    // Query without specifying enrichAliases (should default to true)
    const result = bundle.query({
      equal: { zone_id: 'Z-001' },
    });

    expect(result.enrichedAliases).toBeDefined();
    expect(result.enrichedAliases!.length).toBe(result.items.length);
    expect(result.enrichedAliases![0].zone_name).toEqual(['Zone A']);

    // Explicitly set to false should disable enrichment
    const resultNoEnrich = bundle.query({
      equal: { zone_id: 'Z-001' },
      enrichAliases: false,
    });

    expect(resultNoEnrich.enrichedAliases).toBeUndefined();
  });
});

