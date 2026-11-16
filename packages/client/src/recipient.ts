/** Hex public keys have one spendable account spelling; named recipients retain theirs. */
export function normalizeXianRecipient(value: string): string {
  const recipient = value.trim();
  return /^[0-9a-fA-F]{64}$/.test(recipient) ? recipient.toLowerCase() : recipient;
}
