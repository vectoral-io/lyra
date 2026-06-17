import type { CreateBundleConfig, FieldName, FieldType, SimpleBundleConfig } from '../types';
/**
 * Check if a value is a simple primitive or array of primitives.
 * Used to determine if a field should be auto-added as meta.
 */
export declare function isSimpleValue(value: unknown): boolean;
/**
 * Infer the field type from actual values in the items array.
 * @internal
 */
export declare function inferFieldType<T extends Record<string, unknown>>(items: T[], field: FieldName<T>, mode: 'none' | 'runtime'): FieldType;
/**
 * Infer the range type (number or date) from actual values in the items array.
 * Validates that values are numeric or parseable dates.
 * @internal
 */
export declare function inferRangeType<T extends Record<string, unknown>>(items: T[], field: FieldName<T>, mode: 'none' | 'runtime'): Extract<FieldType, 'number' | 'date'>;
/**
 * Convert a simple bundle config to an explicit bundle config.
 * Handles type inference, auto-detection of ID fields, and auto-meta behavior.
 * @internal
 */
export declare function fromSimpleConfig<T extends Record<string, unknown>>(items: T[], cfg: SimpleBundleConfig<T>): CreateBundleConfig<T>;
//# sourceMappingURL=type-inference.d.ts.map