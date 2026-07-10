export const XIAN_SIGNED_MESSAGE_VERSION = 1 as const;
const XIAN_SIGNED_MESSAGE_HEADER = "\u0019Xian Signed Message:";

export interface XianSignedMessageInput {
  account: string;
  chainId: string;
  message: string;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function lengthPrefixedField(name: string, value: string): string {
  return `${name}:${utf8ByteLength(value)}:${value}`;
}

export function createXianMessageSigningPayload(
  input: XianSignedMessageInput
): string {
  const account = input.account.trim().toLowerCase();
  const chainId = input.chainId.trim();
  if (!/^[0-9a-f]{64}$/.test(account)) {
    throw new TypeError(
      "message signing account must be a 32-byte hex public key"
    );
  }
  if (!chainId) {
    throw new TypeError("message signing chainId is required");
  }
  if (typeof input.message !== "string") {
    throw new TypeError("message to sign must be a string");
  }
  return [
    XIAN_SIGNED_MESSAGE_HEADER,
    String(XIAN_SIGNED_MESSAGE_VERSION),
    lengthPrefixedField("chain-id", chainId),
    lengthPrefixedField("account", account),
    lengthPrefixedField("message", input.message)
  ].join("\n");
}
