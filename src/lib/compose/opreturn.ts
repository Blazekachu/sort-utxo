const MAX_OP_RETURN_BYTES = 80;

export function encodeOpReturn(text: string): Uint8Array | null {
  if (text.length === 0) return null;
  const payload = new TextEncoder().encode(text);
  if (payload.length > MAX_OP_RETURN_BYTES) {
    throw new Error(`OP_RETURN payload exceeds ${MAX_OP_RETURN_BYTES} bytes`);
  }
  if (payload.length <= 75) {
    const out = new Uint8Array(2 + payload.length);
    out[0] = 0x6a;
    out[1] = payload.length;
    out.set(payload, 2);
    return out;
  }
  const out = new Uint8Array(3 + payload.length);
  out[0] = 0x6a;
  out[1] = 0x4c;
  out[2] = payload.length;
  out.set(payload, 3);
  return out;
}
