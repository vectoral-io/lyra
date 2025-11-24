import { describe, it, expectTypeOf } from 'vitest';
import {
  createBundle,
  LyraBundle,
  type CreateBundleConfig,
  type LyraQuery,
  type LyraResult,
  type LyraManifest,
  type LyraSnapshotInfo,
  type LyraBundleJSON,
  type FieldKind,
  type FieldType,
  type FieldDefinition,
} from '../dist/index.js';

describe('Public API Type Surface', () => {
  type Ticket = {
    id: string;
    status: string;
    priority: string;
    createdAt: string;
  };

  it('CreateBundleConfig is properly typed', () => {
    const config: CreateBundleConfig<Ticket> = {
      datasetId: 'tickets',
      fields: {
        id: { kind: 'id', type: 'string' },
        status: { kind: 'facet', type: 'string' },
        priority: { kind: 'facet', type: 'string' },
        createdAt: { kind: 'range', type: 'date' },
      },
    };

    expectTypeOf(config).toMatchTypeOf<CreateBundleConfig<Ticket>>();
    expectTypeOf(config.fields.id).toMatchTypeOf<FieldDefinition | undefined>();
  });

  it('createBundle returns correct type', async () => {
    const tickets: Ticket[] = [];
    const config: CreateBundleConfig<Ticket> = {
      datasetId: 'test',
      fields: {
        id: { kind: 'id', type: 'string' },
        status: { kind: 'facet', type: 'string' },
      },
    };

    const bundle = await createBundle(tickets, config);
    expectTypeOf(bundle).toMatchTypeOf<LyraBundle<Ticket>>();
  });

  it('LyraBundle.query returns LyraResult', async () => {
    const tickets: Ticket[] = [
      { id: '1', status: 'open', priority: 'high', createdAt: '2025-01-01' },
    ];
    const config: CreateBundleConfig<Ticket> = {
      datasetId: 'test',
      fields: {
        id: { kind: 'id', type: 'string' },
        status: { kind: 'facet', type: 'string' },
        priority: { kind: 'facet', type: 'string' },
        createdAt: { kind: 'range', type: 'date' },
      },
    };

    const bundle = await createBundle(tickets, config);
    const query: LyraQuery = {
      facets: { status: 'open' },
      ranges: { createdAt: { min: Date.now() - 1000, max: Date.now() } },
      includeFacetCounts: true,
    };

    const result = bundle.query(query);
    expectTypeOf(result).toMatchTypeOf<LyraResult<Ticket>>();
    expectTypeOf(result.items).toMatchTypeOf<Ticket[]>();
    expectTypeOf(result.total).toMatchTypeOf<number>();
    expectTypeOf(result.snapshot).toMatchTypeOf<LyraSnapshotInfo>();
  });

  it('LyraBundle methods return correct types', async () => {
    const tickets: Ticket[] = [];
    const config: CreateBundleConfig<Ticket> = {
      datasetId: 'test',
      fields: {
        id: { kind: 'id', type: 'string' },
        status: { kind: 'facet', type: 'string' },
      },
    };

    const bundle = await createBundle(tickets, config);
    const manifest = bundle.describe();
    const snapshot = bundle.snapshot();
    const json = bundle.toJSON();

    expectTypeOf(manifest).toMatchTypeOf<LyraManifest>();
    expectTypeOf(snapshot).toMatchTypeOf<LyraSnapshotInfo>();
    expectTypeOf(json).toMatchTypeOf<LyraBundleJSON<Ticket>>();
  });

  it('LyraBundle.load returns correct type', () => {
    const json: LyraBundleJSON<Ticket> = {
      manifest: {
        version: '1.0.0',
        datasetId: 'test',
        builtAt: '2025-01-01T00:00:00Z',
        fields: [
          { name: 'id', kind: 'id', type: 'string', ops: ['eq'] },
          { name: 'status', kind: 'facet', type: 'string', ops: ['eq', 'in'] },
        ],
        capabilities: {
          facets: ['status'],
          ranges: [],
        },
      },
      items: [],
      facetIndex: {},
    };

    const bundle = LyraBundle.load(json);
    expectTypeOf(bundle).toMatchTypeOf<LyraBundle<Ticket>>();
  });

  it('FieldKind and FieldType are correct', () => {
    expectTypeOf<FieldKind>().toMatchTypeOf<'id' | 'facet' | 'range' | 'meta'>();
    expectTypeOf<FieldType>().toMatchTypeOf<'string' | 'number' | 'boolean' | 'date'>();
  });
});

