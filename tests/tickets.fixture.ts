export interface Ticket {
  id: string;
  customerId: string;
  customerName: string;
  priority: string;
  status: string;
  productArea: string;
  region: string;
  ownerTeam: string;
  isEscalated: boolean;
  createdAt: string;
  updatedAt: string;
  slaHours: number;
  tags: string[];
  [key: string]: unknown;
}

// Data pools for realistic generation
// ==============================

const CUSTOMERS = [
  { id: 'C-ACME', name: 'Acme Corp' },
  { id: 'C-GLOBEX', name: 'Globex Inc' },
  { id: 'C-INITECH', name: 'Initech' },
  { id: 'C-UMBRELLA', name: 'Umbrella Group' },
  { id: 'C-TECHNOCORP', name: 'TechnoCorp' },
  { id: 'C-DYNAMICS', name: 'Dynamics LLC' },
  { id: 'C-SYSTEMS', name: 'Systems Inc' },
  { id: 'C-ENTERPRISE', name: 'Enterprise Solutions' },
];

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const PRIORITY_WEIGHTS = [0.3, 0.4, 0.2, 0.1]; // low, medium, high, urgent

const STATUSES = ['open', 'in_progress', 'blocked', 'resolved', 'closed'] as const;

const PRODUCT_AREAS = ['analytics', 'core', 'billing', 'mobile', 'integrations'] as const;

const REGIONS = ['NA', 'EU', 'APAC', 'LATAM'] as const;

const OWNER_TEAMS = ['support_l1', 'support_l2', 'engineering', 'cs'] as const;

const SLA_HOURS = [2, 4, 12, 24, 48, 72] as const;

const TAG_POOL = [
  'crash',
  'dashboard',
  'latency',
  'login',
  'payment_failure',
  'feature_request',
  'api',
  'webhook',
  'usage_question',
  'invoice_dispute',
  'bug_report',
  'p0',
  'p1',
  'p2',
  'docs',
  'performance',
  'security',
  'integration',
  'ui',
  'backend',
];

// Utils
// ==============================

/**
 * Default seed and date window for the fixture. Fixed so `generateTicketArray(n)`
 * yields byte-identical tickets every run — a failing test reproduces exactly,
 * and assertions can pin exact counts. Pass a different `seed` for variety.
 */
const DEFAULT_SEED = 0x5eed_1a9a;
const DEFAULT_START_DATE = new Date('2025-01-01T00:00:00.000Z');
const DEFAULT_END_DATE = new Date('2025-12-31T23:59:59.999Z');

type Rng = () => number;

// Mulberry32 — small, fast, deterministic PRNG. Same seed => same sequence.
// (Shared shape with tests/bench/realworld-fixture.ts.)
function makePrng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedRandom<T>(rng: Rng, items: readonly T[], weights: number[]): T {
  const randomValue = rng();
  let cumulativeWeight = 0;

  for (let index = 0; index < items.length; index++) {
    cumulativeWeight += weights[index];
    if (randomValue < cumulativeWeight) {
      return items[index];
    }
  }

  return items[items.length - 1];
}

function randomChoice<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function randomInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randomDate(rng: Rng, startDate: Date, endDate: Date): Date {
  const startTime = startDate.getTime();
  const endTime = endDate.getTime();
  const randomTime = startTime + rng() * (endTime - startTime);
  return new Date(randomTime);
}

function formatISODate(date: Date): string {
  return date.toISOString();
}

function randomTags(rng: Rng): string[] {
  const tagCount = randomInt(rng, 1, 3);
  const selectedTags: string[] = [];
  const availableTags = [...TAG_POOL];

  for (let index = 0; index < tagCount; index++) {
    const randomIndex = Math.floor(rng() * availableTags.length);
    selectedTags.push(availableTags.splice(randomIndex, 1)[0]);
  }

  return selectedTags;
}

// Generator
// ==============================

/**
 * Generator function that yields Ticket items on-demand.
 * Memory-efficient for generating millions of items.
 *
 * @param count - Number of tickets to generate
 * @param startId - Starting ticket ID number (default: 1001)
 * @param startDate - Start date for ticket creation (default: fixed 2025-01-01)
 * @param endDate - End date for ticket creation (default: fixed 2025-12-31)
 * @param seed - PRNG seed; same seed yields identical tickets (default: fixed)
 * @yields {Ticket} Generated ticket items
 */
export function* generateTickets(
  count: number,
  startId: number = 1001,
  startDate: Date = DEFAULT_START_DATE,
  endDate: Date = DEFAULT_END_DATE,
  seed: number = DEFAULT_SEED,
): Generator<Ticket, void, unknown> {
  const rng = makePrng(seed);
  for (let ticketNumber = 0; ticketNumber < count; ticketNumber++) {
    const customer = randomChoice(rng, CUSTOMERS);
    const priority = weightedRandom(rng, PRIORITIES, PRIORITY_WEIGHTS);
    const status = randomChoice(rng, STATUSES);
    const productArea = randomChoice(rng, PRODUCT_AREAS);
    const region = randomChoice(rng, REGIONS);
    const ownerTeam = randomChoice(rng, OWNER_TEAMS);
    const isEscalated = rng() < 0.3;
    const slaHours = randomChoice(rng, SLA_HOURS);

    const createdAt = randomDate(rng, startDate, endDate);
    const updatedAt = randomDate(rng, createdAt, endDate);

    yield {
      id: `T-${startId + ticketNumber}`,
      customerId: customer.id,
      customerName: customer.name,
      priority,
      status,
      productArea,
      region,
      ownerTeam,
      isEscalated,
      createdAt: formatISODate(createdAt),
      updatedAt: formatISODate(updatedAt),
      slaHours,
      tags: randomTags(rng),
    };
  }
}

/**
 * Helper function to convert generator to array for smaller test cases.
 * For large datasets (millions), prefer using the generator directly.
 *
 * @param count - Number of tickets to generate
 * @param startId - Starting ticket ID number (default: 1001)
 * @param startDate - Start date for ticket creation (default: 30 days ago)
 * @param endDate - End date for ticket creation (default: now)
 * @returns Array of generated tickets
 */
export function generateTicketArray(
  count: number,
  startId: number = 1001,
  startDate?: Date,
  endDate?: Date,
  seed?: number,
): Ticket[] {
  return Array.from(generateTickets(count, startId, startDate, endDate, seed));
}

// Backward compatibility: provide a default fixture for existing tests
// ==============================

export const TICKETS_FIXTURE = generateTicketArray(10);
