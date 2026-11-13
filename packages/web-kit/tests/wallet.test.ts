import { describe, expect, it, vi } from "vitest";

import {
  assertSendCallSucceeded,
  connectWallet,
  getInjectedWallet,
  OUT_OF_CHI_MESSAGE,
  sendCall,
  sendCallFailureMessage,
  txFailureText,
  type SendCallResult
} from "../src/index";
import {
  registerInjectedXianProvider,
  type XianInjectionTarget,
  type XianProvider
} from "@xian-tech/provider";

class FakeTarget extends EventTarget implements XianInjectionTarget {
  xian?: XianInjectionTarget["xian"];
  xianProviders?: XianInjectionTarget["xianProviders"];
}

function createRegisteredTarget(provider: XianProvider): FakeTarget {
  const target = new FakeTarget();
  registerInjectedXianProvider({
    target,
    provider,
    metadata: {
      id: "test-xian-wallet",
      name: "Test Xian Wallet"
    }
  });
  return target;
}

describe("@xian-tech/web-kit wallet helpers", () => {
  it("wraps a registered provider injection", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "xian_requestAccounts") {
        return ["a".repeat(64)];
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const provider: XianProvider = {
      request,
      on: vi.fn(),
      removeListener: vi.fn()
    };
    const target = createRegisteredTarget(provider);

    expect(getInjectedWallet({ target })?.metadata?.id).toBe(
      "test-xian-wallet"
    );
    await expect(connectWallet({ target })).resolves.toEqual(["a".repeat(64)]);
  });

  it("ignores an unregistered xian.provider fallback", () => {
    const provider: XianProvider = {
      request: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn()
    };
    const target = new FakeTarget();
    target.xian = { provider, providers: [] };

    expect(getInjectedWallet({ target })).toBeUndefined();
  });

  it("sends provider-backed calls with default wait settings", async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "xian_sendCall") {
        return {
          submitted: true,
          accepted: true,
          finalized: true,
          txHash: "ABC123"
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const provider: XianProvider = {
      request,
      on: vi.fn(),
      removeListener: vi.fn()
    };
    const target = createRegisteredTarget(provider);

    await expect(
      sendCall(
        {
          contract: "currency",
          function: "transfer",
          kwargs: { to: "bob", amount: 5 }
        },
        { target }
      )
    ).resolves.toMatchObject({ txHash: "ABC123" });

    expect(request).toHaveBeenCalledWith({
      method: "xian_sendCall",
      params: [
        {
          intent: {
            contract: "currency",
            function: "transfer",
            kwargs: { to: "bob", amount: 5 }
          },
          mode: undefined,
          waitForTx: true,
          timeoutMs: 30_000,
          pollIntervalMs: undefined
        }
      ]
    });
  });

  it("normalizes failed sendCall results into user-facing errors", () => {
    const failedReceipt: SendCallResult = {
      submitted: true,
      accepted: true,
      finalized: true,
      receipt: { success: false, message: "contract assertion failed" }
    };

    expect(sendCallFailureMessage(failedReceipt)).toBe(
      "contract assertion failed"
    );
    expect(() => assertSendCallSucceeded(failedReceipt)).toThrow(
      "contract assertion failed"
    );
  });

  it("reports each unsettled outcome with the node message or a default", () => {
    const cases: [SendCallResult, string | null][] = [
      [{ submitted: true, accepted: false, message: "bad nonce" }, "bad nonce"],
      [{ submitted: true, accepted: false }, "Transaction was rejected by the node"],
      [{ submitted: false, message: "offline" }, "offline"],
      [{ submitted: false }, "Transaction was not submitted"],
      [{ submitted: true, accepted: true, finalized: false, message: "pending" }, "pending"],
      [
        { submitted: true, accepted: true, finalized: false },
        "Transaction was not finalized before the timeout"
      ],
      [{ submitted: true, accepted: true, finalized: true, error: "wallet closed" }, "wallet closed"],
      [{ submitted: true, accepted: true, finalized: true, error: "  " }, null],
      [{ submitted: true, accepted: true, finalized: true, receipt: { success: true } }, null],
      [{ submitted: true, accepted: true, finalized: true, receipt: { success: false } }, "Transaction failed"]
    ];
    for (const [result, message] of cases) {
      expect(sendCallFailureMessage(result)).toBe(message);
    }
  });

  it("explains an out-of-chi failure as a state change since the estimate", () => {
    const outOfChi: SendCallResult = {
      submitted: true,
      accepted: true,
      finalized: true,
      receipt: { success: false, message: "VmExecutionError('Out of chi.')" }
    };

    expect(sendCallFailureMessage(outOfChi)).toBe(OUT_OF_CHI_MESSAGE);
    expect(() => assertSendCallSucceeded(outOfChi)).toThrow(OUT_OF_CHI_MESSAGE);
    expect(OUT_OF_CHI_MESSAGE).toMatch(/state changed since the estimate/);
    expect(txFailureText("Out of chi.")).toBe(OUT_OF_CHI_MESSAGE);
    expect(txFailureText("contract assertion failed")).toBe("contract assertion failed");
  });
});
