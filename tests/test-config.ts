import type { CreateBundleConfig } from '../src';
import type { Ticket } from './tickets.fixture';

// Test Configuration
// ==============================

export const DATASET_SIZE = 10000;

export const testConfig: CreateBundleConfig<Ticket> = {
  datasetId: 'tickets-2025-11-22',
  fields: {
    id: { kind: 'id', type: 'string' },
    customerId: { kind: 'facet', type: 'string' },
    priority: { kind: 'facet', type: 'string' },
    status: { kind: 'facet', type: 'string' },
    productArea: { kind: 'facet', type: 'string' },
    region: { kind: 'facet', type: 'string' },
    createdAt: { kind: 'range', type: 'date' },
    slaHours: { kind: 'range', type: 'number' },
  },
};

