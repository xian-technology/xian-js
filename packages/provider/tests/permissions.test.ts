import { describe, expect, it } from "vitest";

import {
  createXianDappPolicyForRequest,
  evaluateXianDappPolicy,
  findMatchingXianDappPolicy,
  parseXianDappAction,
  xianDappPoliciesHaveSameScope,
  xianAccountFromCaip10,
  xianAccountToCaip10,
  xianChainIdFromCaip2,
  xianChainIdToCaip2
} from "../src/permissions";

const context = {
  origin: "https://app.example",
  account: "alice",
  chainId: "xian-local",
  now: 1_000
};

describe("@xian-tech/provider permissions", () => {
  it("formats Xian WalletConnect chain and account identifiers", () => {
    expect(xianChainIdToCaip2("xian-local")).toBe("xian:xian-local");
    expect(xianChainIdFromCaip2("xian:xian-local")).toBe("xian-local");
    expect(xianAccountToCaip10("xian-local", "alice")).toBe(
      "xian:xian-local:alice"
    );
    expect(xianAccountFromCaip10("xian:xian-local:alice")).toEqual({
      chainId: "xian-local",
      account: "alice"
    });
  });

  it("parses send-call intents and prepared transactions into comparable actions", () => {
    expect(
      parseXianDappAction({
        method: "xian_sendCall",
        params: [
          {
            intent: {
              contract: "currency",
              function: "transfer",
              kwargs: { to: "bob", amount: "5" },
              chi: 500
            }
          }
        ]
      })
    ).toEqual({
      method: "xian_sendCall",
      chainId: undefined,
      contract: "currency",
      function: "transfer",
      chi: 500,
      kwargs: { to: "bob", amount: "5" }
    });

    expect(
      parseXianDappAction({
        method: "xian_sendTransaction",
        params: [
          {
            tx: {
              payload: {
                sender: "alice",
                chain_id: "xian-local",
                contract: "currency",
                function: "transfer",
                kwargs: { to: "bob" },
                chi_supplied: 900
              }
            }
          }
        ]
      })
    ).toEqual({
      method: "xian_sendTransaction",
      sender: "alice",
      chainId: "xian-local",
      contract: "currency",
      function: "transfer",
      chi: 900,
      kwargs: { to: "bob" }
    });
  });

  it("matches only scoped trusted dapp policies", () => {
    const request = {
      method: "xian_sendCall",
      params: [
        {
          intent: {
            contract: "currency",
            function: "transfer",
            kwargs: { to: "bob", amount: "5" },
            chi: 500
          }
        }
      ]
    };
    const policy = createXianDappPolicyForRequest({
      id: "policy-1",
      ...context,
      request,
      now: 1_000
    });

    expect(policy).toMatchObject({
      origin: context.origin,
      account: context.account,
      chainId: context.chainId,
      methods: ["xian_sendCall"],
      contract: "currency",
      function: "transfer",
      maxChi: 500,
      argumentScope: "exact",
      kwargs: { to: "bob", amount: "5" }
    });

    expect(evaluateXianDappPolicy(policy!, context, request).matched).toBe(true);
    expect(
      evaluateXianDappPolicy(policy!, context, {
        method: "xian_sendCall",
        params: [
          {
            intent: {
              contract: "currency",
              function: "approve",
              kwargs: {},
              chi: 500
            }
          }
        ]
      }).reason
    ).toBe("function mismatch");
    expect(
      evaluateXianDappPolicy(policy!, context, {
        method: "xian_sendCall",
        params: [
          {
            intent: {
              contract: "currency",
              function: "transfer",
              kwargs: { to: "bob" },
              chi: 501
            }
          }
        ]
      }).reason
    ).toBe("chi limit exceeded");
    expect(
      evaluateXianDappPolicy(policy!, context, {
        method: "xian_sendCall",
        params: [
          {
            intent: {
              contract: "currency",
              function: "transfer",
              kwargs: { to: "mallory", amount: "5" },
              chi: 500
            }
          }
        ]
      }).reason
    ).toBe("arguments mismatch");
    expect(
      evaluateXianDappPolicy(policy!, context, {
        method: "xian_sendCall",
        params: [
          {
            intent: {
              contract: "currency",
              function: "transfer",
              kwargs: { to: "bob", amount: "5", memo: "extra" },
              chi: 500
            }
          }
        ]
      }).reason
    ).toBe("arguments mismatch");
  });

  it("supports explicit broad trusted dapp policies", () => {
    const request = {
      method: "xian_sendCall",
      params: [
        {
          intent: {
            contract: "currency",
            function: "transfer",
            kwargs: { to: "bob", amount: "5" },
            chi: 500
          }
        }
      ]
    };
    const policy = createXianDappPolicyForRequest({
      id: "policy-broad",
      ...context,
      request,
      now: 1_000,
      argumentScope: "any"
    });

    expect(policy).toMatchObject({
      argumentScope: "any",
      kwargs: undefined
    });
    expect(
      evaluateXianDappPolicy(policy!, context, {
        method: "xian_sendCall",
        params: [
          {
            intent: {
              contract: "currency",
              function: "transfer",
              kwargs: { to: "mallory", amount: "500" },
              chi: 500
            }
          }
        ]
      }).matched
    ).toBe(true);
  });

  it("treats exact kwargs as part of trusted policy scope", () => {
    const base = {
      id: "policy-1",
      ...context,
      methods: ["xian_sendCall" as const],
      contract: "currency",
      function: "transfer",
      maxChi: 500,
      argumentScope: "exact" as const,
      createdAt: 1_000
    };

    expect(
      xianDappPoliciesHaveSameScope(
        { ...base, kwargs: { to: "bob", amount: "5" } },
        { ...base, id: "policy-2", kwargs: { amount: "5", to: "bob" } }
      )
    ).toBe(true);
    expect(
      xianDappPoliciesHaveSameScope(
        { ...base, kwargs: { to: "bob", amount: "5" } },
        { ...base, id: "policy-3", kwargs: { to: "alice", amount: "5" } }
      )
    ).toBe(false);
    expect(
      xianDappPoliciesHaveSameScope(
        { ...base, argumentScope: "any", kwargs: undefined },
        { ...base, id: "policy-4", argumentScope: "any", kwargs: undefined }
      )
    ).toBe(true);
    expect(
      xianDappPoliciesHaveSameScope(
        { ...base, argumentScope: "any", kwargs: undefined },
        { ...base, id: "policy-5", kwargs: { to: "bob", amount: "5" } }
      )
    ).toBe(false);
  });

  it("finds the first matching policy", () => {
    const matching = {
      id: "policy-2",
      ...context,
      methods: ["xian_sendCall" as const],
      contract: "currency",
      function: "transfer",
      createdAt: 1_000
    };

    const match = findMatchingXianDappPolicy(
      [
        {
          ...matching,
          id: "wrong",
          function: "approve"
        },
        matching
      ],
      context,
      {
        method: "xian_sendCall",
        params: [
          {
            intent: {
              contract: "currency",
              function: "transfer",
              kwargs: {},
              chi: 500
            }
          }
        ]
      }
    );

    expect(match).toMatchObject({
      matched: true,
      policy: expect.objectContaining({ id: "policy-2" })
    });
  });
});
