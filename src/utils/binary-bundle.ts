/**
 * Binary container format v4 for Lyra bundles.
 *
 * Layout:
 * ```
 * +-----------------------------------------------+
 * | magic       : 5 bytes "LYRA4"                 |
 * | flags       : u32 LE  (reserved; 0 in v4.x)   |
 * | header_len  : u32 LE                          |
 * | header JSON : header_len bytes UTF-8          |
 * | (pad to 8-byte boundary)                      |
 * | body                                          |
 * |   - items block        (UTF-8 JSON | columns) |
 * |   - facetIndex block   (varint posting lists) |
 * |   - nullIndex block    (varint posting lists) |
 * |   - rangeColumns block (raw f64, 8B aligned)  |
 * +-----------------------------------------------+
 * ```
 *
 * v4.1 introduced the columnar items encoding (`items.encoding === 'columnar'`).
 * v4.0 emitted only `items.encoding === 'json'`. Both are still acceptable on
 * the read path; new bundles default to columnar for smaller wire size and
 * faster cold-start hydrate.
 *
 * Block offsets in the header are body-relative; the reader resolves them
 * against `bodyStart`, which is the first 8-byte-aligned offset after the
 * header. This lets the encoder compose body and header independently.
 *
 * @internal
 */

import type {
  InMemoryFacetIndex,
  InMemoryNullIndex,
  LyraManifest,
  RangeColumns,
} from '../types';
import { BinaryReader, BinaryWriter, concatChunks } from './binary';
import { deltaVarintDecodeBytes, deltaVarintEncodeBytes } from './codec';
import {
  type Column,
  type ColumnLoader,
  ColumnarItemStore,
  encodeColumns,
} from './item-store';

const MAGIC = 'LYRA4';
const MAGIC_LEN = 5;
const ALIGN = 8;
const U32_BYTES = 4;
const F64_BYTES = 8;
const BITS_PER_BYTE = 8;

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

/** A byte range in the body: offset (body-relative) and length. */
interface Slot { off: number; len: number }
interface RangeSlot extends Slot { dtype: 'f64' }

interface ItemsSlotJson { encoding: 'json'; off: number; len: number }
interface ItemsSlotColumnar {
  encoding: 'columnar';
  length: number;
  fieldNames: string[];
  fields: Record<string, ColumnSlot>;
}
type ItemsSlot = ItemsSlotJson | ItemsSlotColumnar;

/**
 * Per-column byte-range table, discriminated on `encoding` so each variant
 * carries exactly the slots its encoding needs (mirrors `Column`).
 */
type ColumnSlot =
  | { encoding: 'utf8-dict'; nullBitmap: Slot; dict: Slot & { count: number; offsets: Slot }; indices: Slot }
  | { encoding: 'f64'; nullBitmap: Slot; data: Slot }
  | { encoding: 'u8-bool'; nullBitmap: Slot; data: Slot }
  | { encoding: 'json-fallback'; nullBitmap: Slot; jsonOffsets: Slot; jsonBytes: Slot };

interface V4Header {
  manifest: LyraManifest;
  blocks: {
    items: ItemsSlot;
    facetIndex: Record<string, Record<string, Slot>>;
    nullIndex: Record<string, Slot>;
    rangeColumns: Record<string, RangeSlot>;
  };
}

/**
 * Columnar items are represented at the V4 boundary as a `loadColumn` accessor
 * (decodes a column on demand) plus field names and row count — the same shape
 * whether we're about to encode or have just decoded. This keeps
 * `encodeV4(decodeV4(bytes))` symmetric and lets both sides stay lazy.
 */
export type V4ItemsInput<T extends Record<string, unknown>> =
  | { kind: 'rows'; rows: T[] }
  | { kind: 'columnar'; loadColumn: ColumnLoader; fieldNames: string[]; length: number };

export interface V4Payload<T extends Record<string, unknown>> {
  manifest: LyraManifest;
  items: V4ItemsInput<T>;
  facetIndex: InMemoryFacetIndex;
  nullIndex: InMemoryNullIndex;
  rangeColumns: RangeColumns;
}

/**
 * Returns true if `bytes` begins with the v4 magic header.
 */
export function isV4Bundle(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC_LEN) return false;
  for (let i = 0; i < MAGIC_LEN; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

export function encodeV4<T extends Record<string, unknown>>(
  payload: V4Payload<T>,
  options: { itemsFormat?: 'columnar' | 'json' } = {},
): Uint8Array {
  const itemsFormat = options.itemsFormat ?? 'columnar';

  const body = new BinaryWriter();

  let itemsSlot: ItemsSlot;
  if (itemsFormat === 'json') {
    const jsonStr = JSON.stringify(
      payload.items.kind === 'rows'
        ? payload.items.rows
        : materializeColumnsForSerialize(payload.items),
    );
    const off = body.cursor;
    const len = body.writeUtf8(jsonStr);
    itemsSlot = { encoding: 'json', off, len };
  }
  else {
    const columnar = payload.items.kind === 'columnar'
      ? payload.items
      : rowsToColumnarSource(payload.items.rows);
    itemsSlot = writeColumnarItems(body, columnar);
  }

  const facetIndex: Record<string, Record<string, Slot>> = {};
  for (const field of Object.keys(payload.facetIndex)) {
    const byValue = payload.facetIndex[field];
    const out: Record<string, Slot> = {};
    for (const valueKey of Object.keys(byValue)) {
      const bytes = deltaVarintEncodeBytes(byValue[valueKey]);
      const off = body.cursor;
      body.writeBytes(bytes);
      out[valueKey] = { off, len: bytes.length };
    }
    facetIndex[field] = out;
  }

  const nullIndex: Record<string, Slot> = {};
  for (const field of Object.keys(payload.nullIndex)) {
    const bytes = deltaVarintEncodeBytes(payload.nullIndex[field]);
    const off = body.cursor;
    body.writeBytes(bytes);
    nullIndex[field] = { off, len: bytes.length };
  }

  const rangeColumns: Record<string, RangeSlot> = {};
  for (const field of Object.keys(payload.rangeColumns)) {
    body.align(ALIGN);
    const col = payload.rangeColumns[field];
    const off = body.cursor;
    body.writeF64Bytes(col);
    rangeColumns[field] = { off, len: col.byteLength, dtype: 'f64' };
  }

  const bodyBytes = body.finalize();

  const header: V4Header = {
    manifest: payload.manifest,
    blocks: { items: itemsSlot, facetIndex, nullIndex, rangeColumns },
  };

  const writer = new BinaryWriter();
  const magicBytes = new Uint8Array(MAGIC_LEN);
  for (let i = 0; i < MAGIC_LEN; i++) magicBytes[i] = MAGIC.charCodeAt(i);
  writer.writeBytes(magicBytes);
  writer.writeU32LE(0); // flags

  const headerWriter = new BinaryWriter();
  const headerByteLen = headerWriter.writeUtf8(JSON.stringify(header));
  const headerBytes = headerWriter.finalize();
  writer.writeU32LE(headerByteLen);
  writer.writeBytes(headerBytes);
  writer.align(ALIGN);
  writer.writeBytes(bodyBytes);

  return writer.finalize();
}

export function decodeV4<T extends Record<string, unknown>>(bytes: Uint8Array): V4Payload<T> {
  if (!isV4Bundle(bytes)) {
    throw new Error('Invalid v4 bundle: magic mismatch (expected "LYRA4")');
  }

  const reader = new BinaryReader(bytes);
  reader.seek(MAGIC_LEN);
  reader.readU32LE(); // flags
  const headerLen = reader.readU32LE();

  if (reader.cursor + headerLen > bytes.length) {
    throw new Error(`Invalid v4 bundle: header_len ${headerLen} exceeds buffer length`);
  }

  const headerJson = reader.readUtf8(headerLen);
  let header: V4Header;
  try {
    header = JSON.parse(headerJson) as V4Header;
  }
  catch(err) {
    throw new Error(`Invalid v4 bundle: header JSON parse failed (${(err as Error).message})`);
  }

  if (!header.manifest || !header.blocks) {
    throw new Error('Invalid v4 bundle: header missing manifest or blocks');
  }

  const bodyStart = (reader.cursor + (ALIGN - 1)) & ~(ALIGN - 1);
  if (bodyStart > bytes.length) {
    throw new Error(`Invalid v4 bundle: body start ${bodyStart} exceeds buffer length`);
  }

  const items = decodeItems<T>(bytes, bodyStart, header.blocks.items);

  // Bundle-controlled keys (field names, facet values) populate these maps.
  // Use null-prototype objects so a key like "__proto__" becomes an own
  // property instead of mutating the map's prototype — which would both
  // corrupt query-time lookups and hide the key from the capability allow-list
  // check (Object.keys) in the loader.
  const facetIndex: InMemoryFacetIndex = Object.create(null);
  for (const field of Object.keys(header.blocks.facetIndex)) {
    const byValue = header.blocks.facetIndex[field];
    const out: Record<string, Uint32Array> = Object.create(null);
    for (const valueKey of Object.keys(byValue)) {
      out[valueKey] = deltaVarintDecodeBytes(sliceBlob(bytes, bodyStart, byValue[valueKey]));
    }
    facetIndex[field] = out;
  }

  const nullIndex: InMemoryNullIndex = Object.create(null);
  for (const field of Object.keys(header.blocks.nullIndex)) {
    nullIndex[field] = deltaVarintDecodeBytes(sliceBlob(bytes, bodyStart, header.blocks.nullIndex[field]));
  }

  const rangeColumns: RangeColumns = Object.create(null);
  for (const field of Object.keys(header.blocks.rangeColumns)) {
    const slot = header.blocks.rangeColumns[field];
    if (slot.dtype !== 'f64') {
      throw new Error(
        `Invalid v4 bundle: rangeColumns["${field}"] has unsupported dtype "${slot.dtype}"`,
      );
    }
    checkSlot(slot, bodyStart, bytes.length);
    rangeColumns[field] = reader.readF64View(bodyStart + slot.off, slot.len);
  }

  return { manifest: header.manifest, items, facetIndex, nullIndex, rangeColumns };
}

// ---- Items: JSON path ----

function decodeItems<T extends Record<string, unknown>>(
  bytes: Uint8Array,
  bodyStart: number,
  slot: ItemsSlot,
): V4ItemsInput<T> {
  if (slot.encoding === 'json') {
    const parsed = JSON.parse(utf8Decoder.decode(sliceBlob(bytes, bodyStart, slot))) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid v4 bundle: JSON items payload must be an array');
    }
    return { kind: 'rows', rows: parsed as T[] };
  }
  if (slot.encoding === 'columnar') {
    // `length` is an attacker-controlled integer that drives `new Uint32Array(length)`
    // allocations (allIndices + scratch buffers) on first query. Validate it against
    // the actual column bytes so a tiny header can't claim billions of rows and OOM.
    validateColumnarLength(bytes, bodyStart, slot);
    // Lazy: hand back a loader that decodes a single column on first touch.
    // The buffer is retained by the closure; only columns actually read get
    // materialized into `Column`s.
    return {
      kind: 'columnar',
      loadColumn: makeColumnLoader(bytes, bodyStart, slot),
      fieldNames: slot.fieldNames,
      length: slot.length,
    };
  }
  throw new Error(`Invalid v4 bundle: unsupported items encoding "${(slot as { encoding: string }).encoding}"`);
}

/**
 * Reject a columnar `length` that can't be backed by the column data present in
 * the buffer. Every column carries a null bitmap of `ceil(length / 8)` bytes, so
 * `nullBitmap.len * 8` is an upper bound on the rows a column can describe; the
 * true row count can't exceed the smallest such bound. With no columns, fall
 * back to the buffer length as a coarse ceiling (no encoding packs more than one
 * row per byte across the whole buffer). This is what stops an allocation bomb:
 * a 30-byte header claiming 2^30 rows fails here instead of at `new Uint32Array`.
 */
function validateColumnarLength(bytes: Uint8Array, bodyStart: number, slot: ItemsSlotColumnar): void {
  if (!Number.isInteger(slot.length) || slot.length < 0) {
    throw new Error(`Invalid v4 bundle: columnar items length ${slot.length} is not a valid row count`);
  }
  let maxRows = bytes.length;
  for (const field of slot.fieldNames) {
    const fieldSlot = slot.fields[field];
    if (!fieldSlot) {
      throw new Error(`Invalid v4 bundle: columnar items missing field "${field}"`);
    }
    checkSlot(fieldSlot.nullBitmap, bodyStart, bytes.length);
    const rowsFromBitmap = fieldSlot.nullBitmap.len * BITS_PER_BYTE;
    if (rowsFromBitmap < maxRows) maxRows = rowsFromBitmap;
  }
  if (slot.length > maxRows) {
    throw new Error(
      `Invalid v4 bundle: columnar length ${slot.length} exceeds capacity implied by column data (${maxRows})`,
    );
  }

  // Beyond the null bitmap, each encoding's payload must be large enough to hold
  // `length` rows, or a lazy read would silently return garbage past the slice.
  for (const field of slot.fieldNames) {
    assertColumnCapacity(field, slot.fields[field], slot.length);
  }
}

/** Throw if `haveBytes` can't hold `needBytes` for a column's payload slot. */
function assertSlotBytes(field: string, label: string, haveBytes: number, needBytes: number, rows: number): void {
  if (haveBytes < needBytes) {
    throw new Error(
      `Invalid v4 bundle: column "${field}" ${label} slot has ${haveBytes} bytes, needs ${needBytes} for ${rows} rows`,
    );
  }
}

/** Reject a column whose encoding-specific payload can't back `rows` rows. */
function assertColumnCapacity(field: string, fieldSlot: ColumnSlot, rows: number): void {
  switch (fieldSlot.encoding) {
    case 'utf8-dict':
      assertSlotBytes(field, 'indices', fieldSlot.indices.len, rows * U32_BYTES, rows);
      break;
    case 'f64':
      assertSlotBytes(field, 'data', fieldSlot.data.len, rows * F64_BYTES, rows);
      break;
    case 'u8-bool':
      assertSlotBytes(field, 'data', fieldSlot.data.len, Math.ceil(rows / BITS_PER_BYTE), rows);
      break;
    case 'json-fallback':
      // One offset per row plus a trailing end offset.
      assertSlotBytes(field, 'jsonOffsets', fieldSlot.jsonOffsets.len, (rows + 1) * U32_BYTES, rows);
      break;
  }
}

/**
 * Build a loader that decodes one column at a time from the encoded buffer,
 * closing over the buffer and the columnar slot table. Columns are decoded
 * only when requested (memoization is the caller's responsibility).
 */
function makeColumnLoader(bytes: Uint8Array, bodyStart: number, slot: ItemsSlotColumnar): ColumnLoader {
  return (field: string): Column => {
    const fieldSlot = slot.fields[field];
    if (!fieldSlot) {
      throw new Error(`Invalid v4 bundle: columnar items missing field "${field}"`);
    }
    return readColumn(bytes, bodyStart, fieldSlot);
  };
}

// ---- Items: columnar path ----

function writeColumnarItems(
  body: BinaryWriter,
  payload: { loadColumn: ColumnLoader; fieldNames: string[]; length: number },
): ItemsSlotColumnar {
  const fields: Record<string, ColumnSlot> = {};
  for (const field of payload.fieldNames) {
    fields[field] = writeColumn(body, payload.loadColumn(field));
  }
  return {
    encoding: 'columnar',
    length: payload.length,
    fieldNames: payload.fieldNames,
    fields,
  };
}

/**
 * Encode rows into columns once, then expose them as a `loadColumn` accessor so
 * the columnar write path is uniform regardless of input shape.
 */
function rowsToColumnarSource<T extends Record<string, unknown>>(
  rows: T[],
): { loadColumn: ColumnLoader; fieldNames: string[]; length: number } {
  const { columns, fieldNames } = encodeColumns(rows);
  return { loadColumn: (field) => columns[field], fieldNames, length: rows.length };
}

function writeColumn(body: BinaryWriter, col: Column): ColumnSlot {
  const nullBitmap = writeBlob(body, col.nullBitmap);

  switch (col.encoding) {
    case 'utf8-dict': {
      // Encode dictionary as concat of UTF-8 strings + parallel offset table.
      const encoded = encodeStringTable(col.dict);
      const offsets = writeBlob(body, encoded.offsets);
      const dictBlob = writeBlob(body, encoded.bytes);
      // Indices: raw u32 LE; align to 4 for cleaner layout (we copy on read).
      const indicesBytes = new Uint8Array(col.indices.buffer, col.indices.byteOffset, col.indices.byteLength);
      const indices = writeBlob(body, indicesBytes);
      return {
        encoding: 'utf8-dict',
        nullBitmap,
        dict: { off: dictBlob.off, len: dictBlob.len, count: col.dict.length, offsets },
        indices,
      };
    }
    case 'f64': {
      body.align(ALIGN);
      const off = body.cursor;
      body.writeF64Bytes(col.data);
      return { encoding: 'f64', nullBitmap, data: { off, len: col.data.byteLength } };
    }
    case 'u8-bool':
      return { encoding: 'u8-bool', nullBitmap, data: writeBlob(body, col.data) };
    case 'json-fallback': {
      const offsetsBytes = new Uint8Array(col.jsonOffsets.buffer, col.jsonOffsets.byteOffset, col.jsonOffsets.byteLength);
      const jsonOffsets = writeBlob(body, offsetsBytes);
      const jsonBytes = writeBlob(body, col.jsonBytes);
      return { encoding: 'json-fallback', nullBitmap, jsonOffsets, jsonBytes };
    }
  }
}

function readColumn(bytes: Uint8Array, bodyStart: number, slot: ColumnSlot): Column {
  const nullBitmap = sliceBlob(bytes, bodyStart, slot.nullBitmap);

  switch (slot.encoding) {
    case 'utf8-dict': {
      const offsetsBytes = sliceBlob(bytes, bodyStart, slot.dict.offsets);
      const dictBytes = sliceBlob(bytes, bodyStart, slot.dict);
      const dict = decodeStringTable(offsetsBytes, dictBytes, slot.dict.count);
      const indicesBytes = sliceBlob(bytes, bodyStart, slot.indices);
      const indicesCopy = new Uint32Array(indicesBytes.byteLength / U32_BYTES);
      new Uint8Array(indicesCopy.buffer).set(indicesBytes);
      return { encoding: 'utf8-dict', nullBitmap, dict, indices: indicesCopy };
    }
    case 'f64': {
      checkSlot(slot.data, bodyStart, bytes.length);
      const reader = new BinaryReader(bytes);
      const data = reader.readF64View(bodyStart + slot.data.off, slot.data.len);
      return { encoding: 'f64', nullBitmap, data };
    }
    case 'u8-bool':
      return { encoding: 'u8-bool', nullBitmap, data: sliceBlob(bytes, bodyStart, slot.data) };
    case 'json-fallback': {
      const offsetsBytes = sliceBlob(bytes, bodyStart, slot.jsonOffsets);
      const offsetsCopy = new Uint32Array(offsetsBytes.byteLength / U32_BYTES);
      new Uint8Array(offsetsCopy.buffer).set(offsetsBytes);
      const jsonBytes = sliceBlob(bytes, bodyStart, slot.jsonBytes);
      return { encoding: 'json-fallback', nullBitmap, jsonOffsets: offsetsCopy, jsonBytes };
    }
    default:
      throw new Error(`Invalid v4 bundle: unsupported column encoding "${(slot as { encoding: string }).encoding}"`);
  }
}

// ---- Helpers ----

function writeBlob(body: BinaryWriter, bytes: Uint8Array): Slot {
  const off = body.cursor;
  body.writeBytes(bytes);
  return { off, len: bytes.length };
}

/**
 * Validate a block slot's offset and length before slicing. Header offsets are
 * attacker-controlled on an untrusted bundle: a negative or fractional `off`
 * would slip past a bare upper-bound check and make `subarray` reinterpret the
 * range relative to the buffer end, silently yielding the wrong bytes (a view,
 * a posting list, or a range column over attacker-chosen data) rather than a
 * clean rejection. Require non-negative safe integers within bounds.
 */
function checkSlot(slot: { off: number; len: number }, bodyStart: number, bufLen: number): void {
  if (!Number.isInteger(slot.off) || slot.off < 0 || !Number.isInteger(slot.len) || slot.len < 0) {
    throw new Error(`Invalid v4 bundle: block slot has invalid off/len (off=${slot.off}, len=${slot.len})`);
  }
  if (bodyStart + slot.off + slot.len > bufLen) {
    const lo = bodyStart + slot.off;
    throw new Error(`Invalid v4 bundle: block [${lo}, ${lo + slot.len}) exceeds buffer length ${bufLen}`);
  }
}

function sliceBlob(
  bytes: Uint8Array,
  bodyStart: number,
  slot: { off: number; len: number },
): Uint8Array {
  checkSlot(slot, bodyStart, bytes.length);
  const off = bodyStart + slot.off;
  return bytes.subarray(off, off + slot.len);
}

function encodeStringTable(strings: string[]): { offsets: Uint8Array; bytes: Uint8Array } {
  const offsets = new Uint32Array(strings.length + 1);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let i = 0; i < strings.length; i++) {
    offsets[i] = total;
    const enc = utf8Encoder.encode(strings[i]);
    chunks.push(enc);
    total += enc.length;
  }
  offsets[strings.length] = total;
  const bytes = concatChunks(chunks, total);
  return { offsets: new Uint8Array(offsets.buffer, offsets.byteOffset, offsets.byteLength), bytes };
}

function decodeStringTable(offsetsBytes: Uint8Array, dictBytes: Uint8Array, count: number): string[] {
  if (offsetsBytes.byteLength !== (count + 1) * U32_BYTES) {
    throw new Error(`Invalid v4 bundle: dict offsets length ${offsetsBytes.byteLength} != ${(count + 1) * U32_BYTES}`);
  }
  const offsets = new Uint32Array(count + 1);
  new Uint8Array(offsets.buffer).set(offsetsBytes);
  const out: string[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const start = offsets[i];
    const end = offsets[i + 1];
    out[i] = utf8Decoder.decode(dictBytes.subarray(start, end));
  }
  return out;
}

function materializeColumnsForSerialize<T extends Record<string, unknown>>(
  items: { loadColumn: ColumnLoader; fieldNames: string[]; length: number },
): T[] {
  const columns: Record<string, Column> = {};
  for (const field of items.fieldNames) columns[field] = items.loadColumn(field);
  return new ColumnarItemStore<T>(columns, items.fieldNames, items.length).materializeAll();
}
