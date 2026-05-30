import { describe, expect, it, vi } from "vitest";

import {
  assertSendCallSucceeded,
  connectWallet,
  getInjectedWallet,
  sendCall,
  sendCallFailureMessage,
  type SendCallResult
} from "../src/index";
import type { XianInjectionTarget, XianProvider } from "@xian-tech/provider";

class FakeTarget extends EventTarget implements XianInjectionTarget {
  xian?: XianInjectionTarget["xian"];
  xianProviders?: XianInjectionTarget["xianProviders"];
}

function createLegacyTarget(provider: XianProvider): FakeTarget {
  const target = new FakeTarget();
  target.xian = { provider, providers: [] };
  return target;
}

describe("@xian-tech/web-kit wallet helpers", () => {
  it("wraps a legacy window.xian.provider injection", async () => {
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
    const target = createLegacyTarget(provider);

    expect(getInjectedWallet({ target })?.metadata?.id).toBe(
      "injected-xian-wallet"
    );
    await expect(connectWallet({ target })).resolves.toEqual(["a".repeat(64)]);
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
    const target = createLegacyTarget(provider);

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
});
