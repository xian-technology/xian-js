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
      maxChi: 500,
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
  it.each([undefined, null, 0, -1, 1.5, "abc", "", "0"])(
    "refuses to create a policy without a known positive chi limit: %j",
    (chi) => {
      const intent: Record<string, unknown> = {
        contract: "currency",
        function: "transfer",
        kwargs: { to: "bob", amount: "5" }
      };
      if (chi !== undefined) intent.chi = chi;
      expect(
        createXianDappPolicyForRequest({
          id: "policy-unbounded",
          ...context,
          request: { method: "xian_sendCall", params: [{ intent }] }
        })
      ).toBeNull();
      expect(
        createXianDappPolicyForRequest({
          id: "policy-unbounded-tx",
          ...context,
          request: {
            method: "xian_sendTransaction",
            params: [{ tx: { payload: { ...intent, chi: undefined, chi_supplied: chi, sender: "alice" } } }]
          }
        })
      ).toBeNull();
    }
  );

  it("records the request chi as the policy limit, including large integers", () => {
    const policy = createXianDappPolicyForRequest({
      id: "policy-big",
      ...context,
      request: {
        method: "xian_sendCall",
        params: [{ intent: { contract: "currency", function: "transfer", kwargs: {}, chi: "9007199254740993" } }]
      }
    });
    expect(policy?.maxChi).toBe("9007199254740993");
  });
  it.each([undefined, null, 0, -1, 1.5, "abc", "", "0"])(
    "refuses to auto-approve a stored policy without a valid positive maxChi: %j",
    (maxChi) => {
      const policy = {
        id: "stored",
        ...context,
        methods: ["xian_sendCall" as const],
        contract: "currency",
        function: "transfer",
        argumentScope: "any" as const,
        createdAt: 1_000,
        ...(maxChi === undefined ? {} : { maxChi: maxChi as unknown as number })
      };
      const request = {
        method: "xian_sendCall",
        params: [{ intent: { contract: "currency", function: "transfer", kwargs: {}, chi: 1 } }]
      };
      expect(evaluateXianDappPolicy(policy, context, request)).toMatchObject({
        matched: false,
        reason: "chi limit missing"
      });
      expect(findMatchingXianDappPolicy([policy], context, request).matched).toBe(false);
    }
  );
});
