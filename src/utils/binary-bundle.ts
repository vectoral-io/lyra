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
import { BinaryReader, BinaryWriter } from './binary';
import { deltaVarintDecodeBytes, deltaVarintEncodeBytes } from './codec';
import {
  type Column,
  type ColumnEncoding,
  type ColumnLoader,
  ColumnarItemStore,
  encodeColumns,
} from './item-store';

const MAGIC = 'LYRA4';
const MAGIC_LEN = 5;
const ALIGN = 8;
const U32_BYTES = 4;

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

interface FacetSlot { off: number; len: number }
interface NullSlot { off: number; len: number }
interface RangeSlot { off: number; len: number; dtype: 'f64' }

interface ItemsSlotJson { encoding: 'json'; off: number; len: number }
interface ItemsSlotColumnar {
  encoding: 'columnar';
  length: number;
  fieldNames: string[];
  fields: Record<string, ColumnSlot>;
}
type ItemsSlot = ItemsSlotJson | ItemsSlotColumnar;

interface ColumnSlot {
  encoding: ColumnEncoding;
  /** null bitmap byte slot */
  nullBitmap: { off: number; len: number };
  /** utf8-dict only */
  dict?: { off: number; len: number; count: number; offsets: { off: number; len: number } };
  /** utf8-dict only */
  indices?: { off: number; len: number };
  /** f64 / u8-bool only */
  data?: { off: number; len: number };
  /** json-fallback only */
  jsonOffsets?: { off: number; len: number };
  /** json-fallback only */
  jsonBytes?: { off: number; len: number };
}

interface V4Header {
  manifest: LyraManifest;
  blocks: {
    items: ItemsSlot;
    facetIndex: Record<string, Record<string, FacetSlot>>;
    nullIndex: Record<string, NullSlot>;
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

export type V4ItemsOutput<T extends Record<string, unknown>> = V4ItemsInput<T>;

export interface V4Payload<T extends Record<string, unknown>> {
  manifest: LyraManifest;
  items: V4ItemsInput<T>;
  facetIndex: InMemoryFacetIndex;
  nullIndex: InMemoryNullIndex;
  rangeColumns: RangeColumns;
}

export interface V4DecodedBundle<T extends Record<string, unknown>> {
  manifest: LyraManifest;
  items: V4ItemsOutput<T>;
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

  const facetIndex: Record<string, Record<string, FacetSlot>> = {};
  for (const field of Object.keys(payload.facetIndex)) {
    const byValue = payload.facetIndex[field];
    const out: Record<string, FacetSlot> = {};
    for (const valueKey of Object.keys(byValue)) {
      const bytes = deltaVarintEncodeBytes(byValue[valueKey]);
      const off = body.cursor;
      body.writeBytes(bytes);
      out[valueKey] = { off, len: bytes.length };
    }
    facetIndex[field] = out;
  }

  const nullIndex: Record<string, NullSlot> = {};
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

export function decodeV4<T extends Record<string, unknown>>(bytes: Uint8Array): V4DecodedBundle<T> {
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

  const facetIndex: InMemoryFacetIndex = {};
  for (const field of Object.keys(header.blocks.facetIndex)) {
    const byValue = header.blocks.facetIndex[field];
    const out: Record<string, Uint32Array> = {};
    for (const valueKey of Object.keys(byValue)) {
      const slot = byValue[valueKey];
      const absOff = bodyStart + slot.off;
      const slice = bytes.subarray(absOff, absOff + slot.len);
      out[valueKey] = deltaVarintDecodeBytes(slice);
    }
    facetIndex[field] = out;
  }

  const nullIndex: InMemoryNullIndex = {};
  for (const field of Object.keys(header.blocks.nullIndex)) {
    const slot = header.blocks.nullIndex[field];
    const absOff = bodyStart + slot.off;
    const slice = bytes.subarray(absOff, absOff + slot.len);
    nullIndex[field] = deltaVarintDecodeBytes(slice);
  }

  const rangeColumns: RangeColumns = {};
  for (const field of Object.keys(header.blocks.rangeColumns)) {
    const slot = header.blocks.rangeColumns[field];
    if (slot.dtype !== 'f64') {
      throw new Error(
        `Invalid v4 bundle: rangeColumns["${field}"] has unsupported dtype "${slot.dtype}"`,
      );
    }
    rangeColumns[field] = reader.readF64View(bodyStart + slot.off, slot.len);
  }

  return { manifest: header.manifest, items, facetIndex, nullIndex, rangeColumns };
}

// ---- Items: JSON path ----

function decodeItems<T extends Record<string, unknown>>(
  bytes: Uint8Array,
  bodyStart: number,
  slot: ItemsSlot,
): V4ItemsOutput<T> {
  if (slot.encoding === 'json') {
    const off = bodyStart + slot.off;
    const slice = bytes.subarray(off, off + slot.len);
    const rows = JSON.parse(utf8Decoder.decode(slice)) as T[];
    return { kind: 'rows', rows };
  }
  if (slot.encoding === 'columnar') {
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
  const slot: ColumnSlot = {
    encoding: col.encoding,
    nullBitmap: writeBlob(body, col.nullBitmap),
  };

  switch (col.encoding) {
    case 'utf8-dict': {
      if (!col.dict || !col.indices) throw new Error('Invariant: utf8-dict column missing dict/indices');
      // Encode dictionary as concat of UTF-8 strings + parallel offset table.
      const encoded = encodeStringTable(col.dict);
      slot.dict = {
        off: 0, // filled below after writes
        len: 0,
        count: col.dict.length,
        offsets: { off: 0, len: 0 },
      };
      slot.dict.offsets = writeBlob(body, encoded.offsets);
      const dictBlob = writeBlob(body, encoded.bytes);
      slot.dict.off = dictBlob.off;
      slot.dict.len = dictBlob.len;
      // Indices: raw u32 LE; align to 4 for cleaner layout (we copy on read).
      const indicesBytes = new Uint8Array(col.indices.buffer, col.indices.byteOffset, col.indices.byteLength);
      slot.indices = writeBlob(body, indicesBytes);
      break;
    }
    case 'f64': {
      if (!col.data) throw new Error('Invariant: f64 column missing data');
      body.align(ALIGN);
      const data = col.data as Float64Array;
      const off = body.cursor;
      body.writeF64Bytes(data);
      slot.data = { off, len: data.byteLength };
      break;
    }
    case 'u8-bool': {
      if (!col.data) throw new Error('Invariant: u8-bool column missing data');
      slot.data = writeBlob(body, col.data as Uint8Array);
      break;
    }
    case 'json-fallback': {
      if (!col.jsonOffsets || !col.jsonBytes) throw new Error('Invariant: json-fallback column missing payload');
      const offsetsBytes = new Uint8Array(col.jsonOffsets.buffer, col.jsonOffsets.byteOffset, col.jsonOffsets.byteLength);
      slot.jsonOffsets = writeBlob(body, offsetsBytes);
      slot.jsonBytes = writeBlob(body, col.jsonBytes);
      break;
    }
  }

  return slot;
}

function readColumn(bytes: Uint8Array, bodyStart: number, slot: ColumnSlot): Column {
  const nullBitmap = sliceBlob(bytes, bodyStart, slot.nullBitmap);

  switch (slot.encoding) {
    case 'utf8-dict': {
      if (!slot.dict || !slot.indices) {
        throw new Error('Invalid v4 bundle: utf8-dict column missing dict/indices slots');
      }
      const offsetsBytes = sliceBlob(bytes, bodyStart, slot.dict.offsets);
      const dictBytes = sliceBlob(bytes, bodyStart, slot.dict);
      const dict = decodeStringTable(offsetsBytes, dictBytes, slot.dict.count);
      const indicesBytes = sliceBlob(bytes, bodyStart, slot.indices);
      const indicesCopy = new Uint32Array(indicesBytes.byteLength / U32_BYTES);
      new Uint8Array(indicesCopy.buffer).set(indicesBytes);
      return { encoding: 'utf8-dict', nullBitmap, dict, indices: indicesCopy };
    }
    case 'f64': {
      if (!slot.data) throw new Error('Invalid v4 bundle: f64 column missing data slot');
      const reader = new BinaryReader(bytes);
      const data = reader.readF64View(bodyStart + slot.data.off, slot.data.len);
      return { encoding: 'f64', nullBitmap, data };
    }
    case 'u8-bool': {
      if (!slot.data) throw new Error('Invalid v4 bundle: u8-bool column missing data slot');
      return { encoding: 'u8-bool', nullBitmap, data: sliceBlob(bytes, bodyStart, slot.data) };
    }
    case 'json-fallback': {
      if (!slot.jsonOffsets || !slot.jsonBytes) {
        throw new Error('Invalid v4 bundle: json-fallback column missing slots');
      }
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

function writeBlob(body: BinaryWriter, bytes: Uint8Array): { off: number; len: number } {
  const off = body.cursor;
  body.writeBytes(bytes);
  return { off, len: bytes.length };
}

function sliceBlob(
  bytes: Uint8Array,
  bodyStart: number,
  slot: { off: number; len: number },
): Uint8Array {
  const off = bodyStart + slot.off;
  if (off + slot.len > bytes.length) {
    throw new Error(`Invalid v4 bundle: blob [${off}, ${off + slot.len}) exceeds buffer length ${bytes.length}`);
  }
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
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, off);
    off += chunk.length;
  }
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
