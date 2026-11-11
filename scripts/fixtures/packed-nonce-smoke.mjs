import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { XianClient, NonceReservationError } from "@xian-tech/client";
import { InMemoryXianProvider, ProviderNonceReservationError } from "@xian-tech/provider";

// Resolve from the standalone project, outside every workspace link/source alias.
const installedTypes = realpathSync(fileURLToPath(import.meta.resolve("@xian-tech/types/internal/nonce-reservation")));
assert.ok(installedTypes.startsWith(fileURLToPath(new URL("./node_modules/", import.meta.url))));

const sender = "a".repeat(64);
const signer = { getAddress: () => sender, signMessage: () => "b".repeat(128) };
const response = (data) => new Response(JSON.stringify(data), { status: 200 });
let clientNonce = 7;
const clientObserved = [];
const client = new XianClient({
  rpcUrl: "http://node",
  fetchFn: async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/abci_query") {
      return response({ result: { response: {
        code: 0, value: Buffer.from(String(clientNonce)).toString("base64")
      } } });
    }
    const encoded = JSON.parse(url.searchParams.get("tx"));
    const tx = JSON.parse(Buffer.from(encoded.replace(/^0x/, ""), "hex").toString("utf8"));
    clientObserved.push(tx.payload.nonce);
    return response({ result: { hash: "hash", code: 0 } });
  }
});
const sendClient = (mode) => client.sendTx({
  chainId: "local", sender, signer, contract: "currency", function: "transfer",
  kwargs: {}, chi: 100, mode
});
assert.equal((await sendClient("async")).accepted, null);
await assert.rejects(sendClient("checktx"), NonceReservationError);
clientNonce = 8;
assert.equal((await sendClient("checktx")).nonce, 8);
assert.deepEqual(clientObserved, [7, 8]);

let providerNonce = 10;
const providerObserved = [];
const provider = new InMemoryXianProvider({
  signer,
  client: {
    getChainId: async () => "local",
    buildTx: async (request) => ({ payload: {
      chain_id: request.chainId, sender: request.sender,
      nonce: request.nonce ?? providerNonce, contract: request.contract,
      function: request.function, kwargs: request.kwargs ?? {}, chi_supplied: 100
    } }),
    signTx: async (tx) => ({ ...tx, metadata: { signature: "b".repeat(128) } }),
    broadcastTx: async (tx, options) => {
      providerObserved.push(tx.payload.nonce);
      return {
        submitted: true, accepted: options.mode === "async" ? null : true,
        finalized: false, txHash: "hash", mode: options.mode,
        nonce: tx.payload.nonce, chiSupplied: 100, response: {}
      };
    }
  }
});
await provider.request({ method: "xian_connect" });
const sendProvider = (mode) => provider.request({
  method: "xian_sendCall",
  params: [{ intent: { contract: "currency", function: "transfer", kwargs: {}, chi: 100 }, mode }]
});
assert.equal((await sendProvider("async")).accepted, null);
await assert.rejects(sendProvider("checktx"), ProviderNonceReservationError);
providerNonce = 11;
assert.equal((await sendProvider("checktx")).nonce, 11);
assert.deepEqual(providerObserved, [10, 11]);
console.log(JSON.stringify({ ok: true, clientObserved, providerObserved }));
