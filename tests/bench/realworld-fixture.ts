/**
 * Anonymized real-world fixture: deeply-nested record shapes that match
 * production payloads we want Lyra to handle well.
 *
 *   id:         number   (id field)
 *   uid:        string   (per-row high-cardinality identifier)
 *   group_id:   number   facet
 *   category:   string   facet
 *   tag:        string   facet
 *   bucket_id:  number
 *   status:     'COMPLETE' | 'IN_PROGRESS' | 'NOT_STARTED'  facet
 *   completed_step_ids: string[]
 *   pending_step_ids:   string[]
 *   steps: Record<step_id, { name, weight, completed_on, value, unit,
 *                            phase, phase_id }>
 *
 * Default fixture size is 100K rows: large enough to stress the binary path
 * at realistic scale, small enough to keep `bun run` benches under a minute.
 */

const CATEGORIES = [
  'Cat-Alpha', 'Cat-Beta', 'Cat-Gamma', 'Cat-Delta',
  'Cat-Epsilon', 'Cat-Zeta', 'Cat-Eta', 'Cat-Theta', 'Cat-Iota',
];

const TAGS = [
  'tag-101', 'tag-102', 'tag-103', 'tag-104', 'tag-105',
  'tag-201', 'tag-202', 'tag-203', 'tag-204', 'tag-205',
  'tag-301', 'tag-302', 'tag-303', 'tag-304', 'tag-305',
];

const STEP_CATALOG = [
  { id: 'step-a', name: 'Step A', phase: 'PHASE_1', phase_id: 1, unit: 'EA' },
  { id: 'step-b', name: 'Step B', phase: 'PHASE_2', phase_id: 2, unit: 'LF' },
  { id: 'step-c', name: 'Step C', phase: 'PHASE_3', phase_id: 3, unit: 'EA' },
  { id: 'step-d', name: 'Step D', phase: 'PHASE_4', phase_id: 4, unit: 'EA' },
  { id: 'step-e', name: 'Step E', phase: 'PHASE_5', phase_id: 5, unit: 'LF' },
  { id: 'step-f', name: 'Step F', phase: 'PHASE_6', phase_id: 6, unit: 'EA' },
  { id: 'step-g', name: 'Step G', phase: 'PHASE_7', phase_id: 7, unit: 'EA' },
  { id: 'step-h', name: 'Step H', phase: 'PHASE_8', phase_id: 8, unit: 'EA' },
  { id: 'step-i', name: 'Step I', phase: 'PHASE_9', phase_id: 9, unit: 'EA' },
  { id: 'step-j', name: 'Step J', phase: 'PHASE_10', phase_id: 10, unit: 'LF' },
];

const STATUSES = ['COMPLETE', 'IN_PROGRESS', 'NOT_STARTED'] as const;
type Status = typeof STATUSES[number];

export interface WorkItem {
  id: number;
  uid: string;
  group_id: number;
  category: string;
  tag: string;
  bucket_id: number;
  completed_step_ids: string[];
  pending_step_ids: string[];
  status: Status;
  steps: Record<string, {
    name: string;
    weight: number;
    completed_on: string;
    value: number;
    unit: string;
    phase: string;
    phase_id: number;
  }>;
}

// Mulberry32 — small, fast, deterministic PRNG. Same seed => same fixture.
function makePrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function randomDateBetween(rng: () => number, startMs: number, endMs: number): string {
  const ms = startMs + Math.floor(rng() * (endMs - startMs));
  return new Date(ms).toISOString();
}

function makeUid(rng: () => number): string {
  // 32-hex-char identifier — high cardinality, mimics production GUIDs.
  let out = '';
  for (let i = 0; i < 32; i++) out += Math.floor(rng() * 16).toString(16);
  return out;
}

export interface FixtureOptions {
  itemCount?: number;
  seed?: number;
  /** Number of distinct bucket_id values across the fixture. */
  bucketCount?: number;
  /** Number of distinct group_id values across the fixture. */
  groupCount?: number;
}

/**
 * Generate `itemCount` anonymized `WorkItem` rows. Deterministic given `seed`.
 */
export function generateWorkItems(options: FixtureOptions = {}): WorkItem[] {
  const itemCount = options.itemCount ?? 100_000;
  const seed = options.seed ?? 1;
  const bucketCount = options.bucketCount ?? 12;
  const groupCount = options.groupCount ?? 30;
  const rng = makePrng(seed);

  const yearStart = Date.UTC(2024, 0, 1);
  const yearEnd = Date.UTC(2025, 11, 31);

  const items: WorkItem[] = new Array(itemCount);
  for (let i = 0; i < itemCount; i++) {
    const status = pick(rng, STATUSES);

    // Step count per item: 4-9 steps drawn from the catalog without replacement.
    const stepCount = 4 + Math.floor(rng() * 6);
    const stepOrder = STEP_CATALOG.slice().sort(() => rng() - 0.5).slice(0, stepCount);

    const completed: string[] = [];
    const pending: string[] = [];
    const steps: WorkItem['steps'] = {};
    for (let s = 0; s < stepOrder.length; s++) {
      const def = stepOrder[s];
      const stepDone = status === 'COMPLETE'
        || (status === 'IN_PROGRESS' && s < stepOrder.length / 2);
      steps[def.id] = {
        name: def.name,
        weight: Math.round(rng() * 100 * 100) / 100,
        completed_on: stepDone ? randomDateBetween(rng, yearStart, yearEnd) : '',
        value: Math.round(rng() * 50 * 100) / 100,
        unit: def.unit,
        phase: def.phase,
        phase_id: def.phase_id,
      };
      if (stepDone) completed.push(def.id);
      else pending.push(def.id);
    }

    items[i] = {
      id: i + 1,
      uid: makeUid(rng),
      group_id: 1 + Math.floor(rng() * groupCount),
      category: pick(rng, CATEGORIES),
      tag: pick(rng, TAGS),
      bucket_id: 1 + Math.floor(rng() * bucketCount),
      completed_step_ids: completed,
      pending_step_ids: pending,
      status,
      steps,
    };
  }
  return items;
}

/** Bundle config for the realworld fixture. */
export const WORK_ITEM_CONFIG = {
  datasetId: 'realworld-fixture',
  fields: {
    id: { kind: 'id' as const, type: 'number' as const },
    group_id: { kind: 'facet' as const, type: 'number' as const },
    category: { kind: 'facet' as const, type: 'string' as const },
    tag: { kind: 'facet' as const, type: 'string' as const },
    status: { kind: 'facet' as const, type: 'string' as const },
  },
};
