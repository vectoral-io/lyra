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

function weightedRandom<T>(items: readonly T[], weights: number[]): T {
  const randomValue = Math.random();
  let cumulativeWeight = 0;

  for (let index = 0; index < items.length; index++) {
    cumulativeWeight += weights[index];
    if (randomValue < cumulativeWeight) {
      return items[index];
    }
  }

  return items[items.length - 1];
}

function randomChoice<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(startDate: Date, endDate: Date): Date {
  const startTime = startDate.getTime();
  const endTime = endDate.getTime();
  const randomTime = startTime + Math.random() * (endTime - startTime);
  return new Date(randomTime);
}

function formatISODate(date: Date): string {
  return date.toISOString();
}

function randomTags(): string[] {
  const tagCount = randomInt(1, 3);
  const selectedTags: string[] = [];
  const availableTags = [...TAG_POOL];

  for (let index = 0; index < tagCount; index++) {
    const randomIndex = Math.floor(Math.random() * availableTags.length);
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
 * @param startDate - Start date for ticket creation (default: 30 days ago)
 * @param endDate - End date for ticket creation (default: now)
 * @yields {Ticket} Generated ticket items
 */
export function* generateTickets(
  count: number,
  startId: number = 1001,
  startDate: Date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  endDate: Date = new Date(),
): Generator<Ticket, void, unknown> {
  for (let ticketNumber = 0; ticketNumber < count; ticketNumber++) {
    const customer = randomChoice(CUSTOMERS);
    const priority = weightedRandom(PRIORITIES, PRIORITY_WEIGHTS);
    const status = randomChoice(STATUSES);
    const productArea = randomChoice(PRODUCT_AREAS);
    const region = randomChoice(REGIONS);
    const ownerTeam = randomChoice(OWNER_TEAMS);
    const isEscalated = Math.random() < 0.3;
    const slaHours = randomChoice(SLA_HOURS);

    const createdAt = randomDate(startDate, endDate);
    const updatedAt = randomDate(createdAt, endDate);

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
      tags: randomTags(),
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
): Ticket[] {
  return Array.from(generateTickets(count, startId, startDate, endDate));
}

// Backward compatibility: provide a default fixture for existing tests
// ==============================

export const TICKETS_FIXTURE = generateTicketArray(10);
