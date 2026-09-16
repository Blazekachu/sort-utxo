const TX_OVERHEAD_VB = 10.5;
const P2TR_INPUT_VB = 57.5;
const P2WPKH_INPUT_VB = 68;
const NESTED_INPUT_VB = 91;
const SAT_OUTPUT_VB = 43;

export function estimateComposeVBytes(params: {
  taprootInputs: number;
  p2wpkhInputs: number;
  nestedInputs: number;
  satOutputs: number;
  opReturnScriptLen: number | null;
}): number {
  const { taprootInputs, p2wpkhInputs, nestedInputs, satOutputs, opReturnScriptLen } = params;
  let total = TX_OVERHEAD_VB
    + taprootInputs * P2TR_INPUT_VB
    + p2wpkhInputs * P2WPKH_INPUT_VB
    + nestedInputs * NESTED_INPUT_VB
    + satOutputs * SAT_OUTPUT_VB;
  if (opReturnScriptLen !== null) {
    const scriptLenSize = opReturnScriptLen < 253 ? 1 : 3;
    total += 8 + scriptLenSize + opReturnScriptLen;
  }
  return Math.ceil(total);
}
