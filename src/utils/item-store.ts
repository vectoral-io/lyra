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

const FLAG_NULL = 1;

// Packed-bit helpers. A "bitmap" here is a Uint8Array where each bit at index
// `i` lives in byte `i >>> BIT_INDEX_SHIFT`, position `i & BIT_INDEX_MASK`.
const BIT_INDEX_SHIFT = 3;
const BIT_INDEX_MASK = 7;

function bitByteLen(rows: number): number {
  return (rows + BIT_INDEX_MASK) >>> BIT_INDEX_SHIFT;
}
function setBit(bm: Uint8Array, idx: number): void {
  bm[idx >>> BIT_INDEX_SHIFT] |= 1 << (idx & BIT_INDEX_MASK);
}
function readBit(bm: Uint8Array, idx: number): number {
  return (bm[idx >>> BIT_INDEX_SHIFT] >>> (idx & BIT_INDEX_MASK)) & 1;
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const utf8Encoder = new TextEncoder();

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

export class RowItemStore<T extends Record<string, unknown>> implements ItemStore<T> {
  constructor(private readonly rows: T[]) {}

  get length(): number {
    return this.rows.length;
  }

  getField(idx: number, field: string): unknown {
    return (this.rows[idx] as Record<string, unknown>)[field];
  }

  materializeRow(idx: number): T {
    return this.rows[idx];
  }

  materializeAll(): T[] {
    return this.rows;
  }

  materializeMany(indices: ArrayLike<number>, start: number, len: number): T[] {
    const out: T[] = new Array(len);
    for (let i = 0; i < len; i++) out[i] = this.rows[indices[start + i]];
    return out;
  }
}

// ---- Columnar encoding ----

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

const DICT_DISTINCT_RATIO = 4;
const DICT_MAX_DISTINCT = 65_536;

/**
 * Encode a single field across `rows` into a `Column`. The encoding heuristic
 * picks `utf8-dict` for low-cardinality string columns, `f64` for numeric
 * columns, `u8-bool` for booleans, and `json-fallback` for arrays/objects or
 * mixed-type columns.
 */
export function encodeColumn<T extends Record<string, unknown>>(
  rows: T[],
  field: string,
): Column {
  const len = rows.length;
  const nullBitmap = new Uint8Array(bitByteLen(len));

  // Probe value types to pick an encoding.
  let sawString = 0;
  let sawNumber = 0;
  let sawBool = 0;
  let sawComplex = 0;
  let nonNull = 0;
  for (let i = 0; i < len; i++) {
    const value = (rows[i] as Record<string, unknown>)[field];
    if (value === null || value === undefined) continue;
    nonNull++;
    if (Array.isArray(value) || typeof value === 'object') sawComplex++;
    else if (typeof value === 'string') sawString++;
    else if (typeof value === 'number') sawNumber++;
    else if (typeof value === 'boolean') sawBool++;
    else sawComplex++;
  }

  if (sawComplex > 0 || (sawString > 0 && (sawNumber > 0 || sawBool > 0))) {
    return encodeJsonFallback(rows, field, nullBitmap);
  }

  if (nonNull === 0) {
    // Field is entirely null. Use a degenerate dict column (no values).
    for (let i = 0; i < len; i++) setBit(nullBitmap, i);
    void FLAG_NULL;
    return { encoding: 'utf8-dict', nullBitmap, dict: [], indices: new Uint32Array(len) };
  }

  if (sawBool === nonNull) return encodeBoolColumn(rows, field, len, nullBitmap);
  if (sawNumber === nonNull) return encodeF64Column(rows, field, len, nullBitmap);
  if (sawString === nonNull) {
    const distinct = countDistinctStrings(rows, field, nonNull);
    if (distinct <= DICT_MAX_DISTINCT && distinct * DICT_DISTINCT_RATIO < nonNull) {
      return encodeDictColumn(rows, field, len, nullBitmap);
    }
    // Fall through to dict regardless: simpler and still O(distinct) bytes for
    // the dictionary plus 4n for indices.
    return encodeDictColumn(rows, field, len, nullBitmap);
  }
  return encodeJsonFallback(rows, field, nullBitmap);
}

function encodeBoolColumn<T extends Record<string, unknown>>(
  rows: T[],
  field: string,
  len: number,
  nullBitmap: Uint8Array,
): Column {
  const data = new Uint8Array(bitByteLen(len));
  for (let i = 0; i < len; i++) {
    const raw = (rows[i] as Record<string, unknown>)[field];
    if (raw === null || raw === undefined) {
      setBit(nullBitmap, i);
      continue;
    }
    if (raw === true) setBit(data, i);
  }
  return { encoding: 'u8-bool', nullBitmap, data };
}

function encodeF64Column<T extends Record<string, unknown>>(
  rows: T[],
  field: string,
  len: number,
  nullBitmap: Uint8Array,
): Column {
  const data = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const raw = (rows[i] as Record<string, unknown>)[field];
    if (raw === null || raw === undefined) {
      setBit(nullBitmap, i);
      data[i] = Number.NaN;
      continue;
    }
    data[i] = raw as number;
  }
  return { encoding: 'f64', nullBitmap, data };
}

function countDistinctStrings<T extends Record<string, unknown>>(
  rows: T[],
  field: string,
  expected: number,
): number {
  void expected;
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const raw = (rows[i] as Record<string, unknown>)[field];
    if (typeof raw === 'string') seen.add(raw);
  }
  return seen.size;
}

function encodeDictColumn<T extends Record<string, unknown>>(
  rows: T[],
  field: string,
  len: number,
  nullBitmap: Uint8Array,
): Column {
  const dict: string[] = [];
  const idMap = new Map<string, number>();
  const indices = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    const raw = (rows[i] as Record<string, unknown>)[field];
    if (raw === null || raw === undefined) {
      setBit(nullBitmap, i);
      continue;
    }
    const key = String(raw);
    let id = idMap.get(key);
    if (id === undefined) {
      id = dict.length;
      dict.push(key);
      idMap.set(key, id);
    }
    indices[i] = id;
  }
  return { encoding: 'utf8-dict', nullBitmap, dict, indices };
}

function encodeJsonFallback<T extends Record<string, unknown>>(
  rows: T[],
  field: string,
  nullBitmap: Uint8Array,
): Column {
  const len = rows.length;
  const offsets = new Uint32Array(len + 1);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let i = 0; i < len; i++) {
    const raw = (rows[i] as Record<string, unknown>)[field];
    offsets[i] = total;
    if (raw === null || raw === undefined) {
      setBit(nullBitmap, i);
      continue;
    }
    const bytes = utf8Encoder.encode(JSON.stringify(raw));
    chunks.push(bytes);
    total += bytes.length;
  }
  offsets[len] = total;
  const jsonBytes = new Uint8Array(total);
  let off = 0;
  for (const chunk of chunks) {
    jsonBytes.set(chunk, off);
    off += chunk.length;
  }
  return { encoding: 'json-fallback', nullBitmap, jsonOffsets: offsets, jsonBytes };
}

function isNullAt(bitmap: Uint8Array, idx: number): boolean {
  return readBit(bitmap, idx) === 1;
}

function readColumnValue(col: Column, idx: number): unknown {
  if (isNullAt(col.nullBitmap, idx)) return undefined;
  switch (col.encoding) {
    case 'utf8-dict': {
      if (!col.dict || !col.indices) return undefined;
      return col.dict[col.indices[idx]];
    }
    case 'f64': {
      if (!col.data) return undefined;
      return (col.data as Float64Array)[idx];
    }
    case 'u8-bool': {
      if (!col.data) return undefined;
      return readBit(col.data as Uint8Array, idx) === 1;
    }
    case 'json-fallback': {
      if (!col.jsonOffsets || !col.jsonBytes) return undefined;
      const off = col.jsonOffsets[idx];
      const end = col.jsonOffsets[idx + 1];
      if (off === end) return undefined;
      return JSON.parse(utf8Decoder.decode(col.jsonBytes.subarray(off, end)));
    }
    default:
      return undefined;
  }
}

export class ColumnarItemStore<T extends Record<string, unknown>> implements ItemStore<T> {
  constructor(
    public readonly columns: Record<string, Column>,
    public readonly fieldNames: string[],
    public readonly length: number,
  ) {}

  getField(idx: number, field: string): unknown {
    const col = this.columns[field];
    if (!col) return undefined;
    return readColumnValue(col, idx);
  }

  materializeRow(idx: number): T {
    const out: Record<string, unknown> = {};
    for (const field of this.fieldNames) {
      const value = this.getField(idx, field);
      if (value !== undefined) out[field] = value;
    }
    return out as T;
  }

  materializeAll(): T[] {
    const out: T[] = new Array(this.length);
    for (let i = 0; i < this.length; i++) out[i] = this.materializeRow(i);
    return out;
  }

  materializeMany(indices: ArrayLike<number>, start: number, len: number): T[] {
    const out: T[] = new Array(len);
    for (let i = 0; i < len; i++) out[i] = this.materializeRow(indices[start + i]);
    return out;
  }
}

// ---- Build a column map from rows over the union of field names ----

/**
 * Build the columnar item map for a row collection. Visits the union of keys
 * across rows; columns that are uniformly null still produce a degenerate
 * dict column so `getField` returns `undefined` consistently.
 */
export function encodeColumns<T extends Record<string, unknown>>(
  rows: T[],
): { columns: Record<string, Column>; fieldNames: string[] } {
  const fieldNames = collectFieldNames(rows);
  const columns: Record<string, Column> = {};
  for (const field of fieldNames) columns[field] = encodeColumn(rows, field);
  return { columns, fieldNames };
}

function collectFieldNames<T extends Record<string, unknown>>(rows: T[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row as Record<string, unknown>)) seen.add(key);
  }
  return Array.from(seen);
}
