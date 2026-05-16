const TAG_POINTER = 22n;

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

/**
 * Parse Runestone tag-value pairs and extract the Pointer value.
 * Returns the pointer output index or null if not present.
 */
export function parseRunestonePointer(payload: Uint8Array): number | null {
  let offset = 0;
  while (offset < payload.length) {
    let tag: bigint;
    let tagBytes: number;
    try {
      [tag, tagBytes] = decodeVarint(payload, offset);
    } catch {
      return null;
    }
    offset += tagBytes;

    if (offset >= payload.length) return null;

    let value: bigint;
    let valueBytes: number;
    try {
      [value, valueBytes] = decodeVarint(payload, offset);
    } catch {
      return null;
    }
    offset += valueBytes;

    if (tag === TAG_POINTER) {
      return Number(value);
    }
  }
  return null;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
