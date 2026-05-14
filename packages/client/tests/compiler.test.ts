import { describe, expect, it, vi } from "vitest";

import { TransactionError } from "../src/errors";
import { compileContractArtifacts } from "../src/compiler";

describe("contract compiler bridge", () => {
  it("uses the WASM JSON compiler API with xian_vm_v1 options", async () => {
    const compiler = {
      compileContractArtifactJson: vi.fn(() =>
        JSON.stringify({
          format: "xian_contract_artifact_v1",
          module_name: "con_counter",
          vm_profile: "xian_vm_v1",
          source: "counter = Variable()\n",
          vm_ir_json: "{}",
          hashes: {
            source_sha256: "source",
            vm_ir_sha256: "ir"
          }
        })
      )
    };

    const artifacts = await compileContractArtifacts({
      moduleName: "con_counter",
      source: "counter = Variable()\n",
      compiler
    });

    expect(artifacts).toMatchObject({
      format: "xian_contract_artifact_v1",
      module_name: "con_counter",
      vm_profile: "xian_vm_v1"
    });
    expect(compiler.compileContractArtifactJson).toHaveBeenCalledWith(
      "con_counter",
      "counter = Variable()\n",
      JSON.stringify({ lint: true, vm_profile: "xian_vm_v1" })
    );
  });

  it("rejects malformed JSON from a compiler module", async () => {
    await expect(
      compileContractArtifacts({
        moduleName: "con_counter",
        source: "counter = Variable()\n",
        compiler: {
          compileContractArtifactJson: vi.fn(() => "{")
        }
      })
    ).rejects.toThrow(TransactionError);
  });

  it("fails clearly when a compiler module exposes no supported API", async () => {
    await expect(
      compileContractArtifacts({
        moduleName: "con_counter",
        source: "@export\ndef get():\n    return 1\n",
        compiler: {}
      })
    ).rejects.toThrow(/compileContractArtifact or compileContractArtifactJson/);
  });
});
