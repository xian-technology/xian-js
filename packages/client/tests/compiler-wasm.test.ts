import { describe, expect, it, vi } from "vitest";

import {
  bytesToUtf8,
  decodeRuntime,
  hexToBytes
} from "../src/encoding";
import { Ed25519Signer, XianClient } from "../src/index";
import { compileContractArtifacts } from "../src/index";

const COUNTER_SOURCE = `
counter = Variable()


@construct
def seed():
    counter.set(0)


@export
def increment():
    counter.set(counter.get() + 1)
    return counter.get()
`;

function jsonResponse(value: Record<string, unknown>): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe.runIf(process.env.XIAN_WASM_COMPILER_TEST === "1")(
  "@xian-tech/client real WASM compiler integration",
  () => {
    it("deploys source without submitting client-compiled IR", async () => {
      const signer = new Ed25519Signer("2".repeat(64));
      let signedPayload: Record<string, unknown> | null = null;
      const fetchFn = vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/broadcast_tx_sync")) {
          const encoded = JSON.parse(url.searchParams.get("tx") ?? "\"\"");
          const signed = decodeRuntime<Record<string, unknown>>(
            bytesToUtf8(hexToBytes(encoded))
          );
          signedPayload = signed?.payload as Record<string, unknown>;
          return jsonResponse({
            result: {
              hash: "WASMDEPLOY",
              code: 0
            }
          });
        }
        throw new Error(`unexpected URL: ${String(input)}`);
      }) as typeof fetch;
      const client = new XianClient({
        rpcUrl: "http://127.0.0.1:26657",
        fetchFn,
        chainId: "xian-local"
      });

      const submission = await client.deployContract({
        name: "con_counter",
        source: COUNTER_SOURCE,
        signer,
        nonce: 1,
        chi: 50_000,
        mode: "checktx"
      });

      expect(submission.txHash).toBe("WASMDEPLOY");
      expect(signedPayload?.kwargs).toMatchObject({
        name: "con_counter",
        code: COUNTER_SOURCE
      });
      expect(
        (signedPayload?.kwargs as Record<string, unknown>).deployment_artifacts
      ).toBeUndefined();
    });

    it("preserves a V2 source decimal through the installed WASM compiler", async () => {
      const exact = "9007199254740993.000000000000000000000000000001";
      const source = "@export\ndef amount():\n    return " + exact + "\n";
      const artifacts = await compileContractArtifacts({
        moduleName: "con_amount",
        source
      });
      expect(artifacts.vm_profile).toBe("xian_vm_v2");
      expect(artifacts.vm_ir_json).toContain(exact);
      const { compileContractArtifactJson } = await import("@xian-tech/compiler");
      expect(JSON.parse(compileContractArtifactJson("con_amount", source))).toEqual(artifacts);
    });

    it("compiles explicit V1 source through the installed WASM package", async () => {
      const artifacts = await compileContractArtifacts({
        moduleName: "con_counter",
        source: COUNTER_SOURCE,
        vmProfile: "xian_vm_v1"
      });

      expect(artifacts.format).toBe("xian_contract_artifact_v1");
      expect(artifacts.module_name).toBe("con_counter");
      expect(artifacts.vm_profile).toBe("xian_vm_v1");
    });
  }
);
