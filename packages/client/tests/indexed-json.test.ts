import { describe, expect, it } from "vitest";
import { XianClient, type XianVmProfile } from "../src/index";

function clientWith(value: unknown, vmProfile?: XianVmProfile): XianClient {
  return new XianClient({
    rpcUrl: "http://127.0.0.1:26657",
    vmProfile,
    fetchFn: (async () => new Response(JSON.stringify({ result: { response: {
      code: 0, value: value == null ? "AA==" : Buffer.from(JSON.stringify(value)).toString("base64")
    } } }))) as typeof fetch
  });
}

describe("indexed JSON columns", () => {
  it.each([
    [undefined, '{"__big_int__":"1208925819614629174706176"}'],
    ["xian_vm_v1", "1208925819614629174706176"]
  ] as const)("decodes BDS event columns with the selected profile %s", async (profile, amount) => {
    const row = {
      id: 44, contract: "con_nft", event: "Transfer",
      data_indexed: '{"token_id":"visible-live","from":"","to":"alice"}',
      data: `{"amount":${amount},"__proto__":{"note":"data"}}`
    };
    const client = clientWith([row], profile);
    const [event] = await client.listEvents("con_nft", "Transfer");
    expect(event.dataIndexed).toEqual({ token_id: "visible-live", from: "", to: "alice" });
    expect(event.data?.amount).toBe(2n ** 80n);
    expect(Object.hasOwn(event.data!, "__proto__")).toBe(true);
    expect(event.data?.note).toBeUndefined();
    expect(event.raw).toEqual(row);
    expect((await client.getEventsForTx("hash"))[0].data).toEqual(event.data);
    expect((await clientWith({ available: true, items: [row] }, profile).getRecentEvents()).items[0].data).toEqual(event.data);
  });

  it("accepts object columns and treats malformed/non-object JSON as absent", async () => {
    const rows = [
      { data: { price: "12.500000000000000001" }, data_indexed: "[]" },
      { data: "broken JSON", data_indexed: "null" }
    ];
    const events = await clientWith(rows).listEvents("con_nft", "TokenListed");
    expect(events[0].data).toEqual(rows[0].data);
    expect(events[0].dataIndexed).toBeNull();
    expect(events[1].data).toBeNull();
    expect(events[1].dataIndexed).toBeNull();
  });

  it("decodes indexed transaction payloads and distinguishes absent from empty event indexes", async () => {
    const tx = await clientWith({ payload: '{"contract":"con_nft","kwargs":{"token_id":"a"}}' }).getIndexedTx("hash");
    expect(tx?.payload).toEqual({ contract: "con_nft", kwargs: { token_id: "a" } });
    expect((await clientWith(null).getRecentEvents()).available).toBe(false);
    expect((await clientWith([]).getRecentEvents()).available).toBe(true);
  });
});
