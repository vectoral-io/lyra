import type {
  AnyBundleConfig,
  CreateBundleConfig,
  FacetCounts,
  FacetPostingLists,
  FieldType,
  LyraBundleJSON,
  LyraManifest,
  LyraQuery,
  LyraResult,
  LyraSnapshotInfo,
  RangeBound,
  Scalar,
  SimpleBundleConfig,
} from './types';
import * as arrayOperations from './utils/array-operations';
import { buildFacetIndex, buildLookupTablesFromData, buildManifest } from './utils/builders';
import { fromSimpleConfig } from './utils/type-inference';


/**
 * Create a bundle from items.
 *
 * Overloads:
 * - Explicit config: full control over field kinds/types via `CreateBundleConfig`.
 * - Simple config: ergonomic `SimpleBundleConfig` that infers types from data.
 *
 * Both return a `LyraBundle<T>` with the same runtime behavior.
 */

// Explicit config overload
export function createBundle<T extends Record<string, unknown>>(
  items: T[],
  config: CreateBundleConfig<T>,
): Promise<LyraBundle<T>>;

// Simple config overload
export function createBundle<T extends Record<string, unknown>>(
  items: T[],
  config: SimpleBundleConfig<T>,
): Promise<LyraBundle<T>>;

// Implementation
export async function createBundle<T extends Record<string, unknown>>(
  items: T[],
  config: AnyBundleConfig<T>,
): Promise<LyraBundle<T>> {
  const explicitConfig: CreateBundleConfig<T> =
    'fields' in config
      ? config
      : fromSimpleConfig(items, config as SimpleBundleConfig<T>);

  return LyraBundle.create(items, explicitConfig);
}

/**
 * Immutable bundle of items plus a manifest that describes fields and capabilities.
 */
export class LyraBundle<T extends Record<string, unknown>> {
  private static readonly SCRATCH_ARRAY_COUNT = 2;

  private readonly items: T[];
  private readonly manifest: LyraManifest;
  private readonly facetIndex: FacetPostingLists;
  private readonly scratchA: number[];
  private readonly scratchB: number[];
  private readonly scratchRange: number[];

  private constructor(items: T[], manifest: LyraManifest, facetIndex: FacetPostingLists) {
    this.items = items;
    this.manifest = manifest;
    this.facetIndex = facetIndex;
    this.scratchA = [];
    this.scratchB = [];
    this.scratchRange = [];
  }

  /**
   * Build a new bundle from raw items and bundle configuration.
   */
  static async create<TItem extends Record<string, unknown>>(
    items: TItem[],
    config: CreateBundleConfig<TItem>,
  ): Promise<LyraBundle<TItem>> {
    // Soft validation: check that field names exist in at least one item
    if (items.length > 0) {
      const sampleItem = items[0] as Record<string, unknown>;
      const itemKeys = new Set(Object.keys(sampleItem));

      for (const fieldName of Object.keys(config.fields)) {
        if (!itemKeys.has(fieldName)) {
          // Check if any item has this field
          const hasField = items.some(
            (item) => (item as Record<string, unknown>)[fieldName] !== undefined,
          );
          if (!hasField) {
            // Soft warning - field doesn't exist in any item
            // eslint-disable-next-line no-console
            console.warn(
              `Field "${fieldName}" is configured but does not exist in any items. It will be ignored.`,
            );
          }
        }
      }
    }

    const manifest = buildManifest(config);
    
    // Auto-generate lookup tables if aliases are present
    let finalManifest = manifest;
    if (manifest.capabilities.aliases && manifest.capabilities.aliases.length > 0) {
      // Extract alias mappings from config
      const aliasMappings: Record<string, string> = {};
      for (const field of manifest.fields) {
        if (field.kind === 'alias' && field.aliasTarget) {
          aliasMappings[field.name] = field.aliasTarget;
        }
      }
      
      if (Object.keys(aliasMappings).length > 0) {
        const lookups = buildLookupTablesFromData(items, aliasMappings, manifest);
        finalManifest = {
          ...manifest,
          lookups,
        };
      }
    }
    
    const facetIndex = buildFacetIndex(items, finalManifest);
    return new LyraBundle(items, finalManifest, facetIndex);
  }

  /**
   * Return an empty result with the given applied filters.
   * @internal
   */
  private emptyResult(applied: {
    equal?: LyraQuery['equal'];
    notEqual?: LyraQuery['notEqual'];
    ranges?: LyraQuery['ranges'];
    isNull?: LyraQuery['isNull'];
    isNotNull?: LyraQuery['isNotNull'];
  }): LyraResult<T> {
    return {
      items: [],
      total: 0,
      applied,
      facets: undefined,
      snapshot: this.snapshot(),
      enrichedAliases: [],
    };
  }

  /**
   * Compute candidate indices from equal filters (v2).
   * Treats equal filters as facet-style lookups.
   * @internal
   */
  private getEqualCandidates(equalFilters: Record<string, Scalar | Scalar[]>): number[] {
    if (Object.keys(equalFilters).length === 0) {
      // All indices
      return Array.from({ length: this.items.length }, (_unused, i) => i);
    }

    const facetEntries: Array<{ postings: number[]; size: number }> = [];

    for (const [field, value] of Object.entries(equalFilters)) {
      const postingsForField = this.facetIndex[field];
      if (!postingsForField) {
        // Field not indexed as facet; no matches
        return [];
      }

      const values = Array.isArray(value) ? value : [value];
      
      // Single-value fast path
      if (values.length === 1) {
        const valueKey = String(values[0]);
        const postings = postingsForField[valueKey];
        if (!postings || postings.length === 0) {
          return [];
        }
        facetEntries.push({
          postings,
          size: postings.length,
        });
        continue;
      }

      // Multi-value case: collect postings arrays
      const postingsArrays: number[][] = [];
      for (const facetValue of values) {
        const valueKey = String(facetValue);
        const postings = postingsForField[valueKey];
        if (postings && postings.length > 0) {
          postingsArrays.push(postings);
        }
      }

      if (postingsArrays.length === 0) {
        return [];
      }

      // Merge postings for this field (union for "IN" semantics)
      const mergedPostings = arrayOperations.mergeUnionSorted(postingsArrays);
      const estimatedSize = mergedPostings.length;

      facetEntries.push({
        postings: mergedPostings,
        size: estimatedSize,
      });
    }

    // Sort facets by estimated size ascending
    facetEntries.sort((entryA, entryB) => entryA.size - entryB.size);

    // Intersect facets in order of increasing size
    let candidateIndices: number[] | null = null;

    for (let i = 0; i < facetEntries.length; i++) {
      const facetEntry = facetEntries[i];

      if (candidateIndices === null) {
        // Seed with smallest facet's postings
        candidateIndices = facetEntry.postings;
      }
      else {
        // Intersect with next facet using scratch arrays
        const source = candidateIndices;
        const target =
          i % LyraBundle.SCRATCH_ARRAY_COUNT === 0 ? this.scratchA : this.scratchB;

        arrayOperations.intersectSorted(source, facetEntry.postings, target);
        candidateIndices = target;

        // Early-out if intersection is empty
        if (candidateIndices.length === 0) break;
      }
    }

    if (candidateIndices === null) return Array.from({ length: this.items.length }, (_unused, index) => index);

    return candidateIndices;
  }

  /**
   * Build field type map for range fields.
   * @internal
   */
  private buildRangeFieldTypes(rangeFields: string[]): Record<string, FieldType> {
    const fieldTypes: Record<string, FieldType> = {};
    for (const field of rangeFields) {
      const fieldDef = this.manifest.fields.find((fieldDefinition) => fieldDefinition.name === field);
      if (fieldDef) {
        fieldTypes[field] = fieldDef.type;
      }
    }
    return fieldTypes;
  }

  /**
   * Apply range filters to candidate indices (v2).
   * @internal
   */
  private applyRangeFilters(
    startIndices: number[],
    rangeFilters: Record<string, RangeBound>,
  ): number[] {
    if (Object.keys(rangeFilters).length === 0) return startIndices;

    // Validate range fields
    const rangeFields = Object.keys(rangeFilters);
    const validRangeFields = new Set(this.manifest.capabilities.ranges);
    const hasInvalidRangeField = rangeFields.some((field) => !validRangeFields.has(field));
    if (hasInvalidRangeField) return [];

    // Build field type map and apply range filtering
    const fieldTypes = this.buildRangeFieldTypes(rangeFields);
    arrayOperations.filterIndicesByRange(
      startIndices,
      this.items,
      rangeFilters,
      fieldTypes,
      this.scratchRange,
    );
    return this.scratchRange.slice(); // Return a copy to avoid overwriting
  }

  /**
   * Compute facet counts for the given candidate indices (canonical facets only).
   * @internal
   */
  private computeFacetCounts(indices: number[], facetFields?: string[]): FacetCounts {
    const fieldsToCount = facetFields || this.manifest.capabilities.facets;
    const facetCounts: FacetCounts = {};
    // Cache frequently accessed values
    const items = this.items;
    const numFacets = fieldsToCount.length;

    // Pre-initialize facetCounts objects
    for (let i = 0; i < numFacets; i++) {
      const field = fieldsToCount[i];
      facetCounts[field] = {};
    }

    // Iterate through indices that passed filters
    for (const idx of indices) {
      const item = items[idx] as Record<string, unknown>;
      
      for (let i = 0; i < numFacets; i++) {
        const field = fieldsToCount[i];
        const raw = item[field];
        if (raw === undefined || raw === null) continue;

        // Avoid array wrapping for scalar values
        const countsForField = facetCounts[field];
        
        if (Array.isArray(raw)) {
          for (const value of raw) {
            const valueKey = String(value);
            countsForField[valueKey] = (countsForField[valueKey] ?? 0) + 1;
          }
        }
        else {
          const valueKey = String(raw);
          countsForField[valueKey] = (countsForField[valueKey] ?? 0) + 1;
        }
      }
    }

    return facetCounts;
  }

  /**
   * Execute a v2 query against the bundle.
   *
   * Query contract:
   * - Unknown fields: treated as "no matches" (returns total = 0)
   * - Negative offset: clamped to 0
   * - Negative limit: treated as 0 (no results)
   * - All operators are intersected (AND logic)
   */
  query(query: LyraQuery = {}): LyraResult<T> {
    // 1. Normalize query (extract nulls from equal/notEqual)
    const normalized = normalizeQuery(query);
    
    // 2. Resolve aliases in equal/notEqual filters (Option B: warn and continue)
    const resolvedEqual = resolveAliases(normalized.equalFilters, this.manifest, 'equal');
    const resolvedNotEqual = resolveAliases(normalized.notEqualFilters, this.manifest, 'notEqual');
    
    // 3. Build candidate set from equal filters
    let candidates = this.getEqualCandidates(resolvedEqual);
    
    // 3b. Handle fields with OR null semantics (equal: { field: [val, null] })
    if (normalized.equalWithNull.size > 0) {
      // For each field with OR null, union candidates from equal + null matches
      const nullCandidates: number[] = [];
      for (const field of normalized.equalWithNull) {
        // Get items where this field IS NULL
        for (let i = 0; i < this.items.length; i++) {
          const item = this.items[i] as Record<string, unknown>;
          if (item[field] === null || item[field] === undefined) {
            nullCandidates.push(i);
          }
        }
      }
      // Union equal candidates with null candidates
      if (nullCandidates.length > 0) {
        candidates = arrayOperations.mergeUnionSorted([candidates, nullCandidates]);
      }
    }
    
    // 4. Apply range filters
    candidates = this.applyRangeFilters(candidates, normalized.rangeFilters);
    
    // 5. Apply null checks (for explicit isNull/isNotNull, not OR null from arrays)
    // Remove fields that are in equalWithNull from isNull since they're handled above
    const explicitNullChecks = {
      isNull: normalized.nullChecks.isNull.filter(field => !normalized.equalWithNull.has(field)),
      isNotNull: normalized.nullChecks.isNotNull,
    };
    candidates = filterByNullChecks(candidates, this.items, explicitNullChecks, this.scratchRange);
    
    // 6. Apply exclusions (notEqual)
    candidates = filterByExclusions(candidates, this.items, resolvedNotEqual, this.scratchA);
    
    // 7. Facet counts (canonical facets only)
    const total = candidates.length;
    const facetCounts = query.includeFacetCounts 
      ? this.computeFacetCounts(candidates, this.manifest.capabilities.facets)
      : undefined;
    
    // 8. Pagination
    const start = Math.max(0, query.offset ?? 0);
    const end = query.limit != null ? start + Math.max(0, query.limit) : undefined;
    const paginatedIndices = candidates.slice(start, end);
    let resultItems = paginatedIndices.map(idx => this.items[idx]);
    
    // 9. Enrich with aliases (opt-in, defaults to false)
    // Uses efficient enrichItems() method which deduplicates IDs for optimal performance
    let enrichedAliases: Array<Record<string, string[]>> | undefined;
    if (this.manifest.capabilities.aliases && this.manifest.capabilities.aliases.length > 0) {
      // Opt-in: only enrich if explicitly requested
      const shouldEnrich = query.enrichAliases === true || 
        (Array.isArray(query.enrichAliases) && query.enrichAliases.length > 0);
      
      if (shouldEnrich) {
        const fieldsToEnrich = Array.isArray(query.enrichAliases)
          ? query.enrichAliases.filter(field => this.manifest.capabilities.aliases!.includes(field))
          : this.manifest.capabilities.aliases;
        
        // Use efficient enrichItems() which deduplicates IDs before lookup
        resultItems = this.enrichItems(resultItems, fieldsToEnrich);
        
        // Also populate enrichedAliases for backward compatibility
        enrichedAliases = resultItems.map(item => {
          const enriched: Record<string, string[]> = {};
          for (const aliasField of fieldsToEnrich) {
            const value = (item as any)[aliasField];
            if (value != null) {
              enriched[aliasField] = Array.isArray(value) ? value : [value];
            }
          }
          return enriched;
        });
      }
    }
    
    return {
      items: resultItems,
      total,
      applied: {
        equal: query.equal,
        notEqual: query.notEqual,
        ranges: query.ranges,
        isNull: query.isNull,
        isNotNull: query.isNotNull,
      },
      facets: facetCounts,
      snapshot: this.snapshot(),
      enrichedAliases,
    };
  }

  /**
   * Get a summary of distinct values and counts for a facet field.
   *
   * Useful for building dropdowns and drilldown UIs. Returns distinct values
   * and their counts for a single facet field, optionally filtered by other
   * facets or ranges.
   *
   * @param field - The facet field name to summarize
   * @param options - Optional filters to apply before counting
   * @returns Summary object with field name and array of value/count pairs
   *
   * @example
   * ```ts
   * // Get all distinct status values and counts
   * const summary = bundle.getFacetSummary('status');
   * // { field: 'status', values: [{ value: 'open', count: 5 }, ...] }
   *
   * // Get status values under current filters
   * const filteredSummary = bundle.getFacetSummary('status', {
   *   facets: { customerId: 'C-ACME' }
   * });
   * ```
   */
  getFacetSummary(
    field: string,
    options?: { equal?: LyraQuery['equal']; ranges?: LyraQuery['ranges'] },
  ): { field: string; values: Array<{ value: string | number | boolean; count: number }> } {
    // Robust field validation: check both capabilities and field kind
    const fieldDef = this.manifest.fields.find((fieldDef) => fieldDef.name === field);
    if (
      !fieldDef ||
      fieldDef.kind !== 'facet' ||
      !this.manifest.capabilities.facets.includes(field)
    ) {
      return { field, values: [] };
    }

    // Query with includeFacetCounts, limit: 0 to avoid materializing items
    const result = this.query({
      equal: options?.equal,
      ranges: options?.ranges,
      includeFacetCounts: true,
      limit: 0,
      offset: 0,
    });

    // Extract facet counts with safe fallback
    const rawCounts = result.facets?.[field] ?? {};

    // Convert string keys back to typed values
    const values: Array<{ value: string | number | boolean; count: number }> = [];
    for (const [key, count] of Object.entries(rawCounts)) {
      const typedValue = parseFacetKey(fieldDef.type, key);
      values.push({ value: typedValue, count });
    }

    // Sort by value for stable ordering
    values.sort((first, second) => {
      if (typeof first.value === 'number' && typeof second.value === 'number') {
        return first.value - second.value;
      }
      if (typeof first.value === 'boolean' && typeof second.value === 'boolean') {
        return Number(first.value) - Number(second.value); // false (0) before true (1)
      }
      return String(first.value).localeCompare(String(second.value));
    });

    return { field, values };
  }

  /**
   * Get alias values for a single canonical ID.
   * 
   * @param aliasField - The alias field name (e.g., 'zone_name')
   * @param canonicalId - The canonical ID value
   * @returns Array of alias values, or empty array if not found
   * 
   * @example
   * ```ts
   * const zoneName = bundle.getAliasValues('zone_name', 'Z-001');
   * // Returns: ['Zone A']
   * ```
   */
  getAliasValues(aliasField: string, canonicalId: string | number): string[] {
    const lookup = this.manifest.lookups?.[aliasField];
    if (!lookup?.idToAliases) return [];
    return lookup.idToAliases[String(canonicalId)] || [];
  }

  /**
   * Get alias values for multiple canonical IDs in a single operation.
   * More efficient than individual lookups when enriching multiple items.
   * 
   * @param aliasField - The alias field name (e.g., 'zone_name')
   * @param canonicalIds - Array of canonical IDs to look up
   * @returns Map from canonical ID to array of alias values
   * 
   * @example
   * ```ts
   * const result = bundle.query({ equal: { zone_id: ['Z-001', 'Z-002'] } });
   * const uniqueIds = [...new Set(result.items.map(item => item.zone_id))];
   * const aliasMap = bundle.getAliasMap('zone_name', uniqueIds);
   * // Map back to items
   * const enriched = result.items.map(item => ({
   *   ...item,
   *   zone_name: aliasMap.get(item.zone_id) || []
   * }));
   * ```
   */
  getAliasMap(aliasField: string, canonicalIds: (string | number)[]): Map<string | number, string[]> {
    const lookup = this.manifest.lookups?.[aliasField];
    if (!lookup?.idToAliases) {
      return new Map();
    }
    
    const map = new Map<string | number, string[]>();
    for (const id of canonicalIds) {
      if (id != null) {
        const idKey = String(id);
        const aliases = lookup.idToAliases[idKey];
        if (aliases) {
          map.set(id, aliases);
        }
      }
    }
    return map;
  }

  /**
   * Get the complete ID-to-aliases mapping for an alias field.
   * Useful for building dropdowns or caching all mappings.
   * 
   * @param aliasField - The alias field name
   * @returns Map from canonical ID to array of alias values, or undefined if field not found
   * 
   * @example
   * ```ts
   * const allZones = bundle.getAllAliases('zone_name');
   * // Returns: Map { 'Z-001' => ['Zone A'], 'Z-002' => ['Zone B'], ... }
   * ```
   */
  getAllAliases(aliasField: string): Map<string, string[]> | undefined {
    const lookup = this.manifest.lookups?.[aliasField];
    if (!lookup?.idToAliases) return undefined;
    
    const map = new Map<string, string[]>();
    for (const [id, aliases] of Object.entries(lookup.idToAliases)) {
      map.set(id, aliases);
    }
    return map;
  }

  /**
   * Get alias values for multiple fields and IDs in a single operation.
   * Returns a nested structure: aliasField → canonicalId → aliases[]
   * 
   * @param aliasFields - Array of alias field names
   * @param canonicalIds - Array of canonical IDs to look up
   * @returns Map from alias field name to Map from ID to aliases
   * 
   * @example
   * ```ts
   * const uniqueIds = ['Z-001', 'Z-002'];
   * const multiMap = bundle.getMultiAliasMap(['zone_name', 'zone_label'], uniqueIds);
   * // multiMap.get('zone_name').get('Z-001') => ['Zone A']
   * ```
   */
  getMultiAliasMap(
    aliasFields: string[], 
    canonicalIds: (string | number)[],
  ): Map<string, Map<string | number, string[]>> {
    const result = new Map<string, Map<string | number, string[]>>();
    
    for (const aliasField of aliasFields) {
      result.set(aliasField, this.getAliasMap(aliasField, canonicalIds));
    }
    
    return result;
  }

  /**
   * Transform query results by adding enriched alias fields directly to items.
   * More ergonomic than parallel arrays. Automatically deduplicates IDs for efficiency.
   * 
   * @param result - Query result
   * @param aliasFields - Alias fields to enrich
   * @returns New result with enriched items
   * 
   * @example
   * ```ts
   * const result = bundle.query({ equal: { zone_id: 'Z-001' } });
   * const enriched = bundle.enrichResult(result, ['zone_name', 'zone_label']);
   * // enriched.items[0] = { ...originalItem, zone_name: ['Zone A'], zone_label: ['First Floor'] }
   * ```
   */
  enrichResult(
    result: LyraResult<T>, 
    aliasFields: string[],
  ): LyraResult<T & Record<string, string[]>> {
    // Extract unique IDs per alias field
    const uniqueIdsByField = new Map<string, Set<string | number>>();
    
    for (const aliasField of aliasFields) {
      const fieldDef = this.manifest.fields.find(fieldDef => fieldDef.name === aliasField);
      if (fieldDef?.kind === 'alias' && fieldDef.aliasTarget) {
        const ids = new Set<string | number>();
        for (const item of result.items) {
          const id = (item as any)[fieldDef.aliasTarget];
          if (id != null) ids.add(id);
        }
        uniqueIdsByField.set(aliasField, ids);
      }
    }
    
    // Batch lookup aliases
    const aliasMaps = new Map<string, Map<string | number, string[]>>();
    for (const [aliasField, ids] of uniqueIdsByField) {
      aliasMaps.set(aliasField, this.getAliasMap(aliasField, Array.from(ids)));
    }
    
    // Enrich items
    const enrichedItems = result.items.map(item => {
      const enriched = { ...item } as any;
      for (const [aliasField, aliasMap] of aliasMaps) {
        const fieldDef = this.manifest.fields.find(fieldDef => fieldDef.name === aliasField);
        if (fieldDef?.aliasTarget) {
          const id = item[fieldDef.aliasTarget as keyof typeof item];
          if (id != null) {
            enriched[aliasField] = aliasMap.get(id as string | number) || [];
          }
        }
      }
      return enriched;
    });
    
    return {
      ...result,
      items: enrichedItems,
    };
  }

  /**
   * Enrich items with alias values using efficient batch lookup.
   * Automatically deduplicates IDs and batch looks up aliases for optimal performance.
   * 
   * This is a convenience method that simplifies the common pattern of enriching query results.
   * It extracts unique IDs from items, batch looks up aliases, and maps them back.
   * 
   * @param items - Array of items to enrich
   * @param aliasFields - Array of alias field names to enrich
   * @returns Array of enriched items with alias fields added
   * 
   * @example
   * ```ts
   * const result = bundle.query({ equal: { zone_id: 'Z-001' } });
   * const enriched = bundle.enrichItems(result.items, ['zone_name', 'zone_label']);
   * // enriched[0] = { ...originalItem, zone_name: ['Zone A'], zone_label: ['First Floor'] }
   * ```
   */
  enrichItems(
    items: T[], 
    aliasFields: string[],
  ): Array<T & Record<string, string[]>> {
    // Extract unique IDs per alias field
    const uniqueIdsByField = new Map<string, Set<string | number>>();
    
    for (const aliasField of aliasFields) {
      const fieldDef = this.manifest.fields.find(fieldDef => fieldDef.name === aliasField);
      if (fieldDef?.kind === 'alias' && fieldDef.aliasTarget) {
        const ids = new Set<string | number>();
        for (const item of items) {
          const id = (item as any)[fieldDef.aliasTarget];
          if (id != null) {
            // Handle array values (many-to-many)
            if (Array.isArray(id)) {
              for (const singleId of id) {
                if (singleId != null) ids.add(singleId);
              }
            }
            else {
              ids.add(id);
            }
          }
        }
        uniqueIdsByField.set(aliasField, ids);
      }
    }
    
    // Batch lookup aliases
    const aliasMaps = new Map<string, Map<string | number, string[]>>();
    for (const [aliasField, ids] of uniqueIdsByField) {
      aliasMaps.set(aliasField, this.getAliasMap(aliasField, Array.from(ids)));
    }
    
    // Enrich items
    const enrichedItems = items.map(item => {
      const enriched = { ...item } as any;
      for (const [aliasField, aliasMap] of aliasMaps) {
        const fieldDef = this.manifest.fields.find(fieldDef => fieldDef.name === aliasField);
        if (fieldDef?.aliasTarget) {
          const id = item[fieldDef.aliasTarget as keyof typeof item];
          if (id != null) {
            // Handle array values (many-to-many)
            if (Array.isArray(id)) {
              const aliasSet = new Set<string>();
              for (const singleId of id) {
                if (singleId != null) {
                  const aliases = aliasMap.get(singleId as string | number);
                  if (aliases) {
                    for (const alias of aliases) aliasSet.add(alias);
                  }
                }
              }
              if (aliasSet.size > 0) {
                enriched[aliasField] = Array.from(aliasSet);
              }
            }
            else {
              const aliases = aliasMap.get(id as string | number);
              if (aliases) {
                enriched[aliasField] = aliases;
              }
            }
          }
        }
      }
      return enriched;
    });
    
    return enrichedItems;
  }

  /**
   * Return the bundle manifest describing fields and capabilities.
   */
  describe(): LyraManifest {
    return this.manifest;
  }

  /**
   * Return just the bundle snapshot metadata.
   */
  snapshot(): LyraSnapshotInfo {
    return {
      datasetId: this.manifest.datasetId,
      builtAt: this.manifest.builtAt,
      indexVersion: this.manifest.version,
    };
  }

  /**
   * Serialize the bundle to a plain JSON-compatible structure.
   *
   *! NOTE: Any structural change here must be reflected in docs/bundle-json-spec.md
   */
  toJSON(): LyraBundleJSON<T> {
    return {
      manifest: this.manifest,
      items: this.items,
      facetIndex: this.facetIndex,
    };
  }

  /**
   * Load a bundle from a previously serialized JSON value.
   *
   *! NOTE: Any structural change here must be reflected in docs/bundle-json-spec.md
   */
  static load<TItem extends Record<string, unknown>>(
    raw: LyraBundleJSON<TItem>,
  ): LyraBundle<TItem> {
    if (!raw || !raw.manifest || !raw.items) {
      throw new Error('Invalid bundle JSON: missing manifest or items');
    }

    const { manifest, items, facetIndex } = raw;

    // Validate version (support both v1 and v2)
    if (!manifest.version) {
      throw new Error('Invalid bundle: missing version');
    }
    const versionMajor = manifest.version.split('.')[0];
    if (versionMajor !== '1' && versionMajor !== '2') {
      throw new Error(
        `Invalid bundle version: "${manifest.version}". Expected version starting with "1." or "2."`,
      );
    }

    // Validate that fields array is not empty
    if (!manifest.fields || manifest.fields.length === 0) {
      throw new Error('Invalid bundle: fields array must not be empty');
    }

    // Validate capabilities reference existing fields
    const fieldNames = new Set(manifest.fields.map((field) => field.name));

    for (const facetField of manifest.capabilities.facets) {
      if (!fieldNames.has(facetField)) {
        throw new Error(
          `Invalid bundle: capability references non-existent facet field "${facetField}"`,
        );
      }
    }

    for (const rangeField of manifest.capabilities.ranges) {
      if (!fieldNames.has(rangeField)) {
        throw new Error(
          `Invalid bundle: capability references non-existent range field "${rangeField}"`,
        );
      }
    }

    // Validate facetIndex keys match facet field names
    const facetIndexKeys = new Set(Object.keys(facetIndex ?? {}));
    const expectedFacetFields = new Set(manifest.capabilities.facets);

    for (const indexKey of facetIndexKeys) {
      if (!expectedFacetFields.has(indexKey)) {
        throw new Error(
          `Invalid bundle: facetIndex contains field "${indexKey}" that is not in capabilities.facets`,
        );
      }
    }

    // Ensure all facet fields have entries in facetIndex (empty is OK)
    // Lightweight guard: initialize empty object if facetIndex is missing
    const finalFacetIndex: FacetPostingLists = facetIndex ?? {};
    
    for (const facetField of manifest.capabilities.facets) {
      if (!(facetField in finalFacetIndex)) {
        finalFacetIndex[facetField] = {};
      }
    }

    return new LyraBundle<TItem>(items, manifest, finalFacetIndex);
  }
}

// Utilities
// ==============================

/**
 * Parse a facet key string back to its typed value based on field type.
 * Used internally by getFacetSummary to convert string keys back to typed values.
 * @internal
 */
function parseFacetKey(fieldType: FieldType, key: string): string | number | boolean {
  switch (fieldType) {
    case 'number':
      return Number(key);
    case 'boolean':
      // 'true' -> true, anything else -> false (deterministic)
      return key === 'true';
    default:
      return key; // 'string' or 'date' (though date shouldn't be used here)
  }
}

/**
 * Normalize query operators for internal processing.
 * Handles null value normalization:
 * - equal: { field: null } → isNull: ['field'] (removed from equal)
 * - notEqual: { field: null } → isNotNull: ['field'] (removed from notEqual)
 * 
 * This keeps value-based filters separate from null checks.
 * @internal
 */
function normalizeQuery(query: LyraQuery): {
  equalFilters: Record<string, Scalar | Scalar[]>; // null values removed, but arrays with null tracked separately
  notEqualFilters: Record<string, Scalar | Scalar[]>; // null values removed
  rangeFilters: Record<string, RangeBound>;
  nullChecks: { 
    isNull: string[];    // includes fields from equal: { field: null } or equal: { field: [..., null] }
    isNotNull: string[]; // includes fields from notEqual: { field: null }
  };
  equalWithNull: Set<string>; // Fields in equalFilters that also need null matching (OR semantics)
} {
  const nullChecks = {
    isNull: [...(query.isNull || [])],
    isNotNull: [...(query.isNotNull || [])],
  };
  const equalWithNull = new Set<string>();
  
  // Process equal - extract nulls
  const equalFilters: Record<string, Scalar | Scalar[]> = {};
  if (query.equal) {
    for (const [field, value] of Object.entries(query.equal)) {
      if (value === null) {
        // Normalize null to isNull
        nullChecks.isNull.push(field);
      }
      else if (Array.isArray(value)) {
        // Check if array contains null
        const hasNull = value.includes(null);
        const nonNullValues = value.filter(val => val !== null);
        
        if (value.length === 0) {
          // Empty array means no matches (empty IN clause) - keep it so getEqualCandidates can detect it
          equalFilters[field] = [];
        }
        else if (hasNull && nonNullValues.length > 0) {
          // Array with both values and null: keep values in equalFilters, track OR null semantics
          equalFilters[field] = nonNullValues.length === 1 ? nonNullValues[0] : nonNullValues;
          equalWithNull.add(field);
        }
        else if (hasNull && nonNullValues.length === 0) {
          // Array with only null: normalize to isNull
          nullChecks.isNull.push(field);
        }
        else if (nonNullValues.length > 0) {
          // Array with no null: use as-is
          equalFilters[field] = nonNullValues.length === 1 ? nonNullValues[0] : nonNullValues;
        }
      }
      else {
        equalFilters[field] = value;
      }
    }
  }
  
  // Process notEqual - extract nulls
  const notEqualFilters: Record<string, Scalar | Scalar[]> = {};
  if (query.notEqual) {
    for (const [field, value] of Object.entries(query.notEqual)) {
      if (value === null) {
        // Normalize null to isNotNull
        nullChecks.isNotNull.push(field);
      }
      else if (Array.isArray(value)) {
        // Filter out nulls from array, add field to isNotNull if array contains null
        const nonNullValues = value.filter(val => val !== null);
        if (value.length !== nonNullValues.length) {
          nullChecks.isNotNull.push(field);
        }
        if (nonNullValues.length > 0) {
          notEqualFilters[field] = nonNullValues.length === 1 ? nonNullValues[0] : nonNullValues;
        }
      }
      else {
        notEqualFilters[field] = value;
      }
    }
  }
  
  return {
    equalFilters,
    notEqualFilters,
    rangeFilters: query.ranges || {},
    nullChecks,
    equalWithNull,
  };
}

/**
 * Resolve alias fields to canonical IDs.
 * Option B: Warn and ignore unresolvable values (not a query failure).
 * @internal
 */
function resolveAliases(
  filters: Record<string, Scalar | Scalar[]>,
  manifest: LyraManifest,
  operatorName: 'equal' | 'notEqual',
): Record<string, Scalar | Scalar[]> {
  const resolved: Record<string, Scalar | Scalar[]> = {};
  
  for (const [field, value] of Object.entries(filters)) {
    const fieldDef = manifest.fields.find(fieldDef => fieldDef.name === field);
    
    // Not an alias - pass through
    if (!fieldDef || fieldDef.kind !== 'alias') {
      resolved[field] = value;
      continue;
    }
    
    const lookup = manifest.lookups?.[field];
    if (!lookup) {
      // eslint-disable-next-line no-console
      console.warn(`Alias field '${field}' has no lookup table, ignoring filter`);
      continue;
    }
    
    const values = Array.isArray(value) ? value : [value];
    const resolvedIds: string[] = [];
    
    for (const val of values) {
      const ids = lookup.aliasToIds[String(val)] || [];
      if (ids.length === 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `No mapping found for ${field}='${val}' in ${operatorName}, ignoring this value`,
        );
      }
      resolvedIds.push(...ids);
    }
    
    // Only add if we found at least one ID
    if (resolvedIds.length > 0) {
      const targetField = fieldDef.aliasTarget!;
      const deduped = [...new Set(resolvedIds)];
      resolved[targetField] = deduped.length === 1 ? deduped[0] : deduped;
    }
    // If all values unresolvable, constraint is dropped (no filter on this field)
  }
  
  return resolved;
}

/**
 * Filter indices based on null/not-null constraints.
 * @internal
 */
function filterByNullChecks<T>(
  indices: number[],
  items: T[],
  nullChecks: { isNull: string[]; isNotNull: string[] },
  scratchArray: number[],
): number[] {
  if (nullChecks.isNull.length === 0 && nullChecks.isNotNull.length === 0) {
    return indices;
  }
  
  scratchArray.length = 0;
  
  for (const idx of indices) {
    const item = items[idx] as Record<string, unknown>;
    let matches = true;
    
    // Check isNull constraints
    for (const field of nullChecks.isNull) {
      const value = item[field];
      if (value !== null && value !== undefined) {
        matches = false;
        break;
      }
    }
    
    if (!matches) continue;
    
    // Check isNotNull constraints
    for (const field of nullChecks.isNotNull) {
      const value = item[field];
      if (value === null || value === undefined) {
        matches = false;
        break;
      }
    }
    
    if (matches) {
      scratchArray.push(idx);
    }
  }
  
  return scratchArray;
}

/**
 * Filter to exclude items matching notEqual filters.
 * notEqual applies only to non-null values (null handling via isNull/isNotNull).
 * @internal
 */
function filterByExclusions<T>(
  indices: number[],
  items: T[],
  excludes: Record<string, Scalar | Scalar[]>,
  scratchArray: number[],
): number[] {
  if (Object.keys(excludes).length === 0) {
    return indices;
  }
  
  scratchArray.length = 0;
  
  for (const idx of indices) {
    const item = items[idx] as Record<string, unknown>;
    let excluded = false;
    
    for (const [field, value] of Object.entries(excludes)) {
      const itemValue = item[field];
      const values = Array.isArray(value) ? value : [value];
      
      // notEqual matches if item value is IN the exclusion set AND not null
      if (itemValue !== null && itemValue !== undefined && values.includes(itemValue as any)) {
        excluded = true;
        break;
      }
    }
    
    if (!excluded) {
      scratchArray.push(idx);
    }
  }
  
  return scratchArray;
}
