export type BroadcastMode = "async" | "checktx" | "commit";

export type XianNumber = number | bigint;

export interface XianSigner {
  getAddress?(): Promise<string> | string;
  signMessage(message: string): Promise<string> | string;
}

export interface XianTxPayload {
  chain_id: string;
  contract: string;
  function: string;
  kwargs: Record<string, unknown>;
  nonce: XianNumber;
  sender: string;
  chi_supplied: XianNumber;
}

export interface XianUnsignedTransaction {
  payload: XianTxPayload;
}

export interface XianSignedTransaction {
  payload: XianTxPayload;
  metadata: {
    signature: string;
  };
}
