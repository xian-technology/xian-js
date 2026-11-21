import { base64ToBytes } from "./encoding.js";
import { RpcError } from "./errors.js";
import { asRecord } from "./rpc-response.js";
import { hashSubmittedTransaction } from "./transaction.js";

type ReadRpc = (path: string) => Promise<Record<string, unknown>>;

export class BlockReceiptLookup {
  private nextHeight: number | undefined;

  constructor(private readonly read: ReadRpc, private readonly hash: string) {}

  async find(): Promise<Record<string, unknown> | undefined> {
    const status = asRecord((await this.read("/status")).result);
    const tip = Number(asRecord(status.sync_info).latest_block_height);
    if (!Number.isSafeInteger(tip) || tip < 1) return;
    this.nextHeight ??= Math.max(1, tip - 7);
    while (this.nextHeight <= tip) {
      const result = await this.readBlock(this.nextHeight);
      if (result !== undefined) return result;
      this.nextHeight += 1;
    }
  }

  private async readBlock(height: number): Promise<Record<string, unknown> | undefined> {
    const response = asRecord((await this.read("/block?height=" + height)).result);
    const { txs } = asRecord(asRecord(response.block).data);
    if (!Array.isArray(txs)) return;
    const index = txs.findIndex((tx) =>
      typeof tx === "string" && hashSubmittedTransaction(base64ToBytes(tx)) === this.hash);
    if (index < 0) return;
    const results = asRecord((await this.read("/block_results?height=" + height)).result);
    const items = results.txs_results;
    const txResult: unknown = Array.isArray(items) ? items[index] : undefined;
    if (txResult == null || typeof asRecord(txResult).code !== "number") {
      throw new RpcError("Transaction execution results are unavailable", { height, index, hash: this.hash });
    }
    return { result: {
      hash: this.hash, height: String(height), index, tx: txs[index], tx_result: txResult
    } };
  }
}
