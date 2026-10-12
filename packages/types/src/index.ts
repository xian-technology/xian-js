export type BroadcastMode = "async" | "checktx" | "commit";

export type XianNumber = number | bigint;

export interface XianSigner {
  getAddress?(): Promise<string> | string;
  signMessage(message: string): Promise<string> | string;
  signTransaction?(tx: XianUnsignedTransaction): Promise<XianSignedTransaction> | XianSignedTransaction;
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
    signature?: string;
    tx_format?: "xian_account_v1";
    auth?: { scheme: string; signature: string; active_proof?: string; recovery_proof?: string };
  };
}

export {
  XIAN_SIGNED_MESSAGE_VERSION,
  createXianMessageSigningPayload,
  type XianSignedMessageInput
} from "./message-signing.js";
