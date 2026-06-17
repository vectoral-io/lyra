/**
 * Storage abstractions for item rows.
 *
 * `RowItemStore` wraps a plain `T[]` and is the default at bundle creation
 * time and after JSON / v4.0 binary loads. `ColumnarItemStore` reads from a
 * columnar layout (dictionary-encoded strings, raw f64 numbers, packed bits
 * for booleans, JSON fallback for arrays/objects) and is produced by v4.1
 * binary loads — it never materializes the row mirror, so cold start scales
 * with the columns actually touched by the query.
 *
 * @internal
 */
export interface ItemStore<T extends Record<string, unknown>> {
    readonly length: number;
    /** Read a single field's value at row `idx`. Returns `undefined` if absent or null. */
    getField(idx: number, field: string): unknown;
    /** Reconstruct a full row object. Used at result boundary + serialization. */
    materializeRow(idx: number): T;
    /** Materialize the full row collection. Used by `toJSON` / `serialize('binary')`. */
    materializeAll(): T[];
    /** Materialize a contiguous slice of rows referenced by `indices`. */
    materializeMany(indices: ArrayLike<number>, start: number, len: number): T[];
}
export declare class RowItemStore<T extends Record<string, unknown>> implements ItemStore<T> {
    private readonly rows;
    constructor(rows: T[]);
    get length(): number;
    getField(idx: number, field: string): unknown;
    materializeRow(idx: number): T;
    materializeAll(): T[];
    materializeMany(indices: ArrayLike<number>, start: number, len: number): T[];
}
export type ColumnEncoding = 'utf8-dict' | 'f64' | 'u8-bool' | 'json-fallback';
/**
 * Per-field columnar storage. Each column carries a null bitmap (1 bit per
 * row, packed; bit set = null) so we never confuse `null` from `''` / `0` /
 * `false`.
 */
export interface Column {
    encoding: ColumnEncoding;
    nullBitmap: Uint8Array;
    /** Dictionary table for utf8-dict columns. */
    dict?: string[];
    /** Per-row dict index for utf8-dict columns. */
    indices?: Uint32Array;
    /** Raw values for f64 / u8-bool columns. */
    data?: Float64Array | Uint8Array;
    /** Per-row JSON byte ranges for json-fallback columns. */
    jsonOffsets?: Uint32Array;
    jsonBytes?: Uint8Array;
}
/**
 * Encode a single field across `rows` into a `Column`. The encoding heuristic
 * picks `utf8-dict` for low-cardinality string columns, `f64` for numeric
 * columns, `u8-bool` for booleans, and `json-fallback` for arrays/objects or
 * mixed-type columns.
 */
export declare function encodeColumn<T extends Record<string, unknown>>(rows: T[], field: string): Column;
export declare class ColumnarItemStore<T extends Record<string, unknown>> implements ItemStore<T> {
    readonly columns: Record<string, Column>;
    readonly fieldNames: string[];
    readonly length: number;
    constructor(columns: Record<string, Column>, fieldNames: string[], length: number);
    getField(idx: number, field: string): unknown;
    materializeRow(idx: number): T;
    materializeAll(): T[];
    materializeMany(indices: ArrayLike<number>, start: number, len: number): T[];
}
/**
 * Build the columnar item map for a row collection. Visits the union of keys
 * across rows; columns that are uniformly null still produce a degenerate
 * dict column so `getField` returns `undefined` consistently.
 */
export declare function encodeColumns<T extends Record<string, unknown>>(rows: T[]): {
    columns: Record<string, Column>;
    fieldNames: string[];
};
//# sourceMappingURL=item-store.d.ts.map