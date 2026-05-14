import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  bytesToUtf8,
  decodeRuntime,
  hexToBytes
} from "../src/encoding";
import { Ed25519Signer, XianClient } from "../src/index";
import { compileContractArtifacts } from "../src/compiler";

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

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe.runIf(process.env.XIAN_WASM_COMPILER_TEST === "1")(
  "@xian-tech/client real WASM compiler integration",
  () => {
    it("loads @xian-tech/compiler through the default deployContract path", async () => {
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
      const artifacts = (
        signedPayload?.kwargs as Record<string, unknown>
      ).deployment_artifacts as Record<string, unknown>;
      expect(artifacts).toMatchObject({
        format: "xian_contract_artifact_v1",
        module_name: "con_counter",
        vm_profile: "xian_vm_v1"
      });
      expect(artifacts.runtime_code).toBeUndefined();
      expect((artifacts.hashes as Record<string, string>).source_sha256).toBe(
        sha256(artifacts.source as string)
      );
      expect((artifacts.hashes as Record<string, string>).vm_ir_sha256).toBe(
        sha256(artifacts.vm_ir_json as string)
      );
    });

    it("compiles source through the installed WASM package without injection", async () => {
      const artifacts = await compileContractArtifacts({
        moduleName: "con_counter",
        source: COUNTER_SOURCE
      });

      expect(artifacts.format).toBe("xian_contract_artifact_v1");
      expect(artifacts.module_name).toBe("con_counter");
      expect(artifacts.vm_profile).toBe("xian_vm_v1");
    });
  }
);
