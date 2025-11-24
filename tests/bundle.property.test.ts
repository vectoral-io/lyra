import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { LyraBundle, type LyraResult, type CreateBundleConfig } from '../src';
import {
  configWithItemsAndQueryArb,
  configWithItemsAndQueryNonEmptyArb,
} from './property-generators';

// Naive Baseline Implementation
// ==============================

type BundleItem = Record<string, unknown>;

/**
 * Naive implementation of facet matching using Array.filter.
 * Matches the semantics of bundle.query() for comparison.
 */
function naiveFacetMatch(
  item: BundleItem,
  facets: Record<string, unknown | unknown[]>,
  config: CreateBundleConfig<Record<string, unknown>>,
): boolean {
  for (const [field, value] of Object.entries(facets)) {
    const fieldConfig = config.fields[field];
    if (!fieldConfig || fieldConfig.kind !== 'facet') {
      // Field not configured as facet - no match
      return false;
    }

    const itemValue = item[field];
    if (itemValue === null || itemValue === undefined) {
      // Null/undefined values are excluded
      return false;
    }

    // Handle array values (multi-valued facets)
    const itemValues = Array.isArray(itemValue) ? itemValue : [itemValue];
    const queryValues = Array.isArray(value) ? value : [value];

    // Convert all to strings for comparison (matching bundle behavior)
    const itemValueStrings = itemValues.map((v) => String(v));
    const queryValueStrings = queryValues.map((v) => String(v));

    // Check if any item value matches any query value (IN semantics)
    const matches = itemValueStrings.some((itemStr) =>
      queryValueStrings.includes(itemStr),
    );

    if (!matches) {
      return false;
    }
  }

  return true;
}

/**
 * Naive implementation of range matching using Array.filter.
 */
function naiveRangeMatch(
  item: BundleItem,
  ranges: Record<string, { min?: number; max?: number }>,
  config: CreateBundleConfig<Record<string, unknown>>,
): boolean {
  for (const [field, range] of Object.entries(ranges)) {
    const fieldConfig = config.fields[field];
    if (!fieldConfig || fieldConfig.kind !== 'range') {
      // Field not configured as range - exclude
      return false;
    }

    const rawValue = item[field];
    if (rawValue == null) {
      // Null/undefined values are excluded
      return false;
    }

    // Convert to number (for dates, parse ISO string or use as-is if number)
    const numericValue =
      typeof rawValue === 'number'
        ? rawValue
        : Date.parse(String(rawValue)) || NaN;

    if (Number.isNaN(numericValue)) {
      // Invalid numeric value - exclude
      return false;
    }

    if (range.min != null && numericValue < range.min) {
      return false;
    }

    if (range.max != null && numericValue > range.max) {
      return false;
    }
  }

  return true;
}

/**
 * Naive query implementation using Array.filter.
 * Returns items matching the query (without pagination).
 */
function naiveQuery(
  items: BundleItem[],
  query: LyraQuery,
  config: CreateBundleConfig<Record<string, unknown>>,
): BundleItem[] {
  let filtered = items;

  // Apply facet filters
  if (query.facets && Object.keys(query.facets).length > 0) {
    filtered = filtered.filter((item) =>
      naiveFacetMatch(item, query.facets!, config),
    );
  }

  // Apply range filters
  if (query.ranges && Object.keys(query.ranges).length > 0) {
    filtered = filtered.filter((item) =>
      naiveRangeMatch(item, query.ranges!, config),
    );
  }

  return filtered;
}

/**
 * Compare two query results, ignoring snapshot metadata.
 */
function compareResults(
  resultA: LyraResult<BundleItem>,
  resultB: LyraResult<BundleItem>,
): boolean {
  // Compare totals
  if (resultA.total !== resultB.total) {
    return false;
  }

  // Compare item counts (after pagination)
  if (resultA.items.length !== resultB.items.length) {
    return false;
  }

  // Compare items (order matters for pagination)
  for (let i = 0; i < resultA.items.length; i++) {
    const itemA = resultA.items[i];
    const itemB = resultB.items[i];

    if (!itemA || !itemB) {
      return false;
    }

    // Compare by JSON stringification (simple deep equality)
    if (JSON.stringify(itemA) !== JSON.stringify(itemB)) {
      return false;
    }
  }

  return true;
}

// Property Tests
// ==============================

describe('LyraBundle - Property Tests', () => {
  // Configure fast-check for reproducibility
  const NUM_RUNS = 50;

  it('query results match naive Array.filter implementation', async () => {
    await fc.assert(
      fc.asyncProperty(
        configWithItemsAndQueryArb,
        async ({ config, items, query }) => {
          if (items.length === 0) {
            // Skip empty datasets
            return true;
          }

          const bundle = await LyraBundle.create<BundleItem>(items, config);

          const bundleResult = bundle.query(query);

          // Naive baseline (without pagination)
          const naiveFiltered = naiveQuery(items, query, config);

          // Apply pagination to naive result
          const start = query.offset ?? 0;
          const end = query.limit != null ? start + query.limit : undefined;
          const naivePaginated = naiveFiltered.slice(start, end);

          // Compare totals (should match)
          expect(bundleResult.total).toBe(naiveFiltered.length);

          // Compare paginated items
          expect(bundleResult.items.length).toBe(naivePaginated.length);

          // Compare items (order matters for pagination)
          for (let i = 0; i < bundleResult.items.length; i++) {
            const bundleItem = bundleResult.items[i];
            const naiveItem = naivePaginated[i];

            expect(bundleItem).toBeDefined();
            expect(naiveItem).toBeDefined();

            // Compare by JSON (simple deep equality)
            expect(JSON.stringify(bundleItem)).toBe(JSON.stringify(naiveItem));
          }

          return true;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });


  it('serialization preserves query results (load(toJSON(bundle)).query(q) === bundle.query(q))', async () => {
    await fc.assert(
      fc.asyncProperty(
        configWithItemsAndQueryNonEmptyArb,
        async ({ config, items, query }) => {
          const bundle = await LyraBundle.create<BundleItem>(items, config);
          const json = bundle.toJSON();
          const loaded = LyraBundle.load<BundleItem>(json);

          const originalResult = bundle.query(query);
          const loadedResult = loaded.query(query);

          // Results should be identical
          expect(compareResults(originalResult, loadedResult)).toBe(true);

          // Detailed comparison
          expect(loadedResult.total).toBe(originalResult.total);
          expect(loadedResult.items.length).toBe(originalResult.items.length);

          for (let i = 0; i < originalResult.items.length; i++) {
            expect(JSON.stringify(loadedResult.items[i])).toBe(
              JSON.stringify(originalResult.items[i]),
            );
          }

          // Compare facet counts if present
          if (originalResult.facets || loadedResult.facets) {
            expect(JSON.stringify(loadedResult.facets)).toBe(
              JSON.stringify(originalResult.facets),
            );
          }

          return true;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

