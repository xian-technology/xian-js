import { useEffect, useState } from "react";

import type { RpcClientStore } from "./rpc.js";

export function createUseRpcEpoch<TClient>(store: Pick<
  RpcClientStore<TClient>,
  "getRpcEpoch" | "subscribeRpcEpoch"
>) {
  return function useRpcEpoch(): number {
    const [epoch, setEpoch] = useState(store.getRpcEpoch);
    useEffect(() => store.subscribeRpcEpoch(setEpoch), []);
    return epoch;
  };
}
