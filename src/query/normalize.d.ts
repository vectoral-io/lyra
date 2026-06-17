import type { LyraManifest, LyraQuery, RangeBound, Scalar } from '../types';
/**
 * Result of normalizing a LyraQuery into canonical filter form.
 * @internal
 */
export interface NormalizedQuery {
    equalFilters: Record<string, Scalar | Scalar[]>;
    notEqualFilters: Record<string, Scalar | Scalar[]>;
    rangeFilters: Record<string, RangeBound>;
    nullChecks: {
        isNull: string[];
        isNotNull: string[];
    };
    /** Fields in `equal` that also require null matching (OR semantics from `[val, null]`). */
    equalWithNull: Set<string>;
}
export declare function normalizeQuery(query: LyraQuery): NormalizedQuery;
/**
 * Resolve alias fields in a filter record to their canonical target fields.
 *
 * Policy: values that have no mapping are dropped with a single batched warning per field.
 * If every value for a field is unmapped, the field's constraint is dropped entirely.
 *
 * @internal
 */
export declare function resolveAliases(filters: Record<string, Scalar | Scalar[]>, manifest: LyraManifest, operatorName: 'equal' | 'notEqual'): Record<string, Scalar | Scalar[]>;
//# sourceMappingURL=normalize.d.ts.map