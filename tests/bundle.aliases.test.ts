import { describe, it, expect, vi } from 'vitest';
import { createBundle, type SimpleBundleConfig } from '../src';

describe('LyraBundle - Aliases', () => {
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
      { id: '2', zone_id: 'Z-001', zone_name: 'Zone A Alt' },
      { id: '3', zone_id: 'Z-002', zone_name: 'Zone A' },
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

    expect(lookup.aliasToIds['Zone A']).toContain('Z-001');
    expect(lookup.aliasToIds['Zone A']).toContain('Z-002');
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
    expect(manifest.lookups?.['zone_name']).toBeDefined();
    expect(manifest.lookups?.['zone_label']).toBeDefined();

    const result1 = bundle.query({ equal: { zone_name: 'Zone A' } });
    expect(result1.total).toBe(2);

    const result2 = bundle.query({ equal: { zone_label: 'First Floor' } });
    expect(result2.total).toBe(2);
  });

  it('resolves aliases in queries and warns on unmapped values', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A' },
      { id: '2', zone_id: 'Z-002', zone_name: 'Zone B' },
    ];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: { zone_name: 'zone_id' },
    };

    const bundle = await createBundle(items, config);

    const result1 = bundle.query({ equal: { zone_name: 'Zone A' } });
    expect(result1.total).toBe(1);
    expect(result1.items[0].zone_id).toBe('Z-001');

    const result2 = bundle.query({
      equal: { zone_name: ['Zone A', 'Unknown Zone'] },
    });
    expect(result2.total).toBe(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("No mapping found for zone_name='Unknown Zone'"),
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
      aliases: { zone_name: 'zone_id' },
    };

    const bundle = await createBundle(items, config);

    const result = bundle.query({
      equal: {
        zone_name: 'Zone A',
        status: 'open',
      },
    });

    expect(result.total).toBe(1);
    expect(result.items[0].zone_id).toBe('Z-001');
    expect(result.items[0].status).toBe('open');
  });

  it('enriches items in place when enrichAliases: true', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A' },
      { id: '2', zone_id: 'Z-001', zone_name: 'Zone A' },
      { id: '3', zone_id: 'Z-002', zone_name: 'Zone B' },
    ];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: { zone_name: 'zone_id' },
    };

    const bundle = await createBundle(items, config);

    const result = bundle.query({
      equal: { zone_id: 'Z-001' },
      enrichAliases: true,
    });

    expect(result.items[0].zone_name).toEqual(['Zone A']);
    expect(result.items[1].zone_name).toEqual(['Zone A']);
  });

  it('enriches all declared aliases when enrichAliases: true', async () => {
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
      equal: { zone_id: 'Z-001' },
      enrichAliases: true,
    });

    expect(result.items[0].zone_name).toEqual(['Zone A']);
    expect(result.items[0].zone_label).toEqual(['First Floor']);
  });

  it('enriches only specific alias fields when given a list', async () => {
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
      equal: { zone_id: 'Z-001' },
      enrichAliases: ['zone_name'],
    });

    expect(result.items[0].zone_name).toEqual(['Zone A']);
    // zone_label not enriched — retains original source value.
    expect(result.items[0].zone_label).toBe('First Floor');
  });

  it('warns when alias field missing in all items', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const items = [{ id: '1', zone_id: 'Z-001' }];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: { zone_name: 'zone_id' },
    };

    await createBundle(items, config);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('No valid pairs found'),
    );

    consoleSpy.mockRestore();
  });

  it('warns when array values found in alias/target fields', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const items = [{ id: '1', zone_id: 'Z-001', zone_name: ['Zone A'] }];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: { zone_name: 'zone_id' },
    };

    await createBundle(items, config);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Array values not supported'),
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
      aliases: { zone_name: 'zone_id' },
    };

    const bundle = await createBundle(items, config);
    const lookup = bundle.describe().lookups!['zone_name'];

    expect(lookup.aliasToIds['']).toEqual(['Z-001']);

    const result = bundle.query({ equal: { zone_name: '' } });
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
      aliases: { zone_name: 'zone_id' },
    };

    const bundle = await createBundle(items, config);

    // Without enrichAliases: items retain the original zone_name value (plain string)
    const result = bundle.query({ equal: { zone_id: 'Z-001' } });
    expect(result.items[0].zone_name).toBe('Zone A');

    // With enrichAliases: items gain a string[] from the lookup table.
    const enriched = bundle.query({
      equal: { zone_id: 'Z-001' },
      enrichAliases: true,
    });
    expect(enriched.items[0].zone_name).toEqual(['Zone A']);
  });

  it('enrichItems helper enriches items efficiently', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A' },
      { id: '2', zone_id: 'Z-001', zone_name: 'Zone A' },
      { id: '3', zone_id: 'Z-002', zone_name: 'Zone B' },
    ];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: { zone_name: 'zone_id' },
    };

    const bundle = await createBundle(items, config);
    const result = bundle.query({ equal: { zone_id: 'Z-001' } });
    const enriched = bundle.enrichItems(result.items, ['zone_name']);

    expect(enriched.length).toBe(2);
    expect(enriched[0].zone_name).toEqual(['Zone A']);
    expect(enriched[1].zone_name).toEqual(['Zone A']);
    expect(enriched[0].id).toBe('1');
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
    const result = bundle.query({ equal: { zone_id: ['Z-001', 'Z-002'] } });
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
      zone_id: i % 10 === 0 ? 'Z-001' : 'Z-002',
      zone_name: i % 10 === 0 ? 'Zone A' : 'Zone B',
    }));

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: { zone_name: 'zone_id' },
    };

    const bundle = await createBundle(items, config);
    const result = bundle.query({ equal: { zone_id: ['Z-001', 'Z-002'] } });
    const enriched = bundle.enrichItems(result.items, ['zone_name']);

    expect(enriched.length).toBe(100);
    expect(enriched[0].zone_name).toEqual(['Zone A']);
    expect(enriched[10].zone_name).toEqual(['Zone A']);
    expect(enriched[1].zone_name).toEqual(['Zone B']);
  });

  it('getAliasValues looks up a single canonical ID', async () => {
    const items = [
      { id: '1', zone_id: 'Z-001', zone_name: 'Zone A' },
      { id: '2', zone_id: 'Z-002', zone_name: 'Zone B' },
    ];

    const config: SimpleBundleConfig<typeof items[0]> = {
      datasetId: 'test',
      facets: ['zone_id'],
      aliases: { zone_name: 'zone_id' },
    };

    const bundle = await createBundle(items, config);

    expect(bundle.getAliasValues('zone_name', 'Z-001')).toEqual(['Zone A']);
    expect(bundle.getAliasValues('zone_name', 'Z-999')).toEqual([]);
    expect(bundle.getAliasValues('nonexistent', 'Z-001')).toEqual([]);
  });
});
