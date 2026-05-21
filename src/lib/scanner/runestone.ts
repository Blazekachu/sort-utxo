const TAG_POINTER = 22n;
const TAG_BODY = 0n;

/**
 * Decode a single LEB128 varint from buffer at offset.
 * Returns [value, bytesRead].
 */
export function decodeVarint(buffer: Uint8Array, offset: number): [bigint, number] {
  let value = 0n;
  let shift = 0n;
  let bytesRead = 0;

  for (let i = offset; i < buffer.length; i++) {
    const byte = buffer[i];
    bytesRead++;
    if (bytesRead > 19) throw new Error('Varint too long');
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [value, bytesRead];
    shift += 7n;
  }
  throw new Error('Unexpected end of varint');
}

/**
 * Check if a scriptPubKey hex is a Runestone OP_RETURN (OP_RETURN OP_13 ...).
 */
export function isRunestoneOutput(scriptHex: string): boolean {
  return scriptHex.startsWith('6a5d');
}

/**
 * Extract the raw payload bytes from a Runestone OP_RETURN scriptPubKey hex.
 * Format: 6a 5d [push opcodes + data chunks]
 * Returns concatenated payload from all data pushes.
 */
export function extractRunestonePayload(scriptHex: string): Uint8Array | null {
  if (!isRunestoneOutput(scriptHex)) return null;

  const bytes = hexToBytes(scriptHex);
  // Skip OP_RETURN (0x6a) and OP_13 (0x5d)
  let offset = 2;
  const chunks: Uint8Array[] = [];

  while (offset < bytes.length) {
    const opcode = bytes[offset];
    offset++;

    let pushLen: number;
    if (opcode <= 75) {
      pushLen = opcode;
    } else if (opcode === 0x4c) {
      // OP_PUSHDATA1
      if (offset >= bytes.length) return null;
      pushLen = bytes[offset];
      offset++;
    } else if (opcode === 0x4d) {
      // OP_PUSHDATA2
      if (offset + 1 >= bytes.length) return null;
      pushLen = bytes[offset] | (bytes[offset + 1] << 8);
      offset += 2;
    } else {
      return null; // unexpected opcode
    }

    if (offset + pushLen > bytes.length) return null;
    chunks.push(bytes.slice(offset, offset + pushLen));
    offset += pushLen;
  }

  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}

export interface RunestoneFields {
  /** Output index designated by the Pointer field, or null if absent. */
  pointer: number | null;
  /** Output indices referenced by edicts — every output that receives runes. */
  edictOutputs: Set<number>;
}

/**
 * Parse a Runestone payload into the fields relevant for UTXO labeling.
 *
 * The payload is a sequence of tag/value integer pairs. The Body tag (0) is
 * special and always last: everything after it is edicts, NOT tag/value
 * pairs. Scanning past the Body tag would misread edict integers as tags —
 * e.g. an edict amount of 22 would be mistaken for a Pointer field.
 */
export function parseRunestone(payload: Uint8Array): RunestoneFields {
  let pointer: number | null = null;
  const edictOutputs = new Set<number>();
  let offset = 0;

  while (offset < payload.length) {
    let tag: bigint;
    let tagBytes: number;
    try {
      [tag, tagBytes] = decodeVarint(payload, offset);
    } catch {
      break;
    }
    offset += tagBytes;

    if (tag === TAG_BODY) {
      // Everything after the Body tag is edicts — parse separately.
      parseEdicts(payload, offset, edictOutputs);
      break;
    }

    if (offset >= payload.length) break;

    let value: bigint;
    let valueBytes: number;
    try {
      [value, valueBytes] = decodeVarint(payload, offset);
    } catch {
      break;
    }
    offset += valueBytes;

    if (tag === TAG_POINTER && pointer === null) {
      pointer = Number(value);
    }
  }

  return { pointer, edictOutputs };
}

/**
 * Parse the edict section of a Runestone Body. Each edict is four varints:
 * (rune block delta, rune tx delta, amount, output). Collects the output
 * index of every edict. A trailing partial group marks a cenotaph; it is
 * ignored (the outputs already collected are still honored).
 */
function parseEdicts(payload: Uint8Array, start: number, outputs: Set<number>): void {
  let offset = start;
  while (offset < payload.length) {
    const fields: bigint[] = [];
    for (let f = 0; f < 4; f++) {
      if (offset >= payload.length) return;
      let v: bigint;
      let n: number;
      try {
        [v, n] = decodeVarint(payload, offset);
      } catch {
        return;
      }
      fields.push(v);
      offset += n;
    }
    // fields[3] is the output index this edict allocates runes to.
    outputs.add(Number(fields[3]));
  }
}

/**
 * Backwards-compatible helper: extract only the Pointer value.
 */
export function parseRunestonePointer(payload: Uint8Array): number | null {
  return parseRunestone(payload).pointer;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
