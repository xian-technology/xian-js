import { TransactionError } from "./errors.js";

/**
 * Chi added to the simulated estimate. A simulation is exact for the state it
 * ran on, but a transaction that lands between simulation and execution can
 * change that state: a stored value can grow by a byte, so execution can need
 * one chi more than the estimate and would fail with "Out of chi". Execution
 * charges only the chi it uses, so the margin costs the sender nothing.
 */
export const CHI_ESTIMATE_MARGIN = 2;

/**
 * The chain's per-transaction chi cap (genesis fee policy `max_tx_chi`).
 * CheckTx refuses a transaction that supplies more.
 */
export const MAX_TX_CHI = 200_000;

/** The chi to supply for a call whose simulation used `estimated` chi. */
export function chiToSupply(estimated: number): number {
  if (estimated > MAX_TX_CHI) {
    throw new TransactionError(
      `the simulated cost of ${estimated} chi exceeds the per-transaction limit of ${MAX_TX_CHI} chi`
    );
  }
  return Math.min(estimated + CHI_ESTIMATE_MARGIN, MAX_TX_CHI);
}
