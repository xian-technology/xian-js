/**
 * Shared with xian-py: supply estimate + max(ceil(estimate * 5%), 10) chi.
 * Simulated cost can drift before execution; unused chi is refunded.
 */
export const DEFAULT_CHI_MARGIN = 0.05;
export const DEFAULT_MIN_CHI_HEADROOM = 10;

export interface ChiHeadroomOptions {
  /** Fractional headroom over the simulated estimate. Default 0.05. */
  chiMargin?: number;
  /** Minimum absolute headroom in chi. Default 10. */
  minChiHeadroom?: number;
}

export function resolveChiHeadroom(
  options: ChiHeadroomOptions = {},
  defaults: Required<ChiHeadroomOptions> = {
    chiMargin: DEFAULT_CHI_MARGIN,
    minChiHeadroom: DEFAULT_MIN_CHI_HEADROOM
  }
): Required<ChiHeadroomOptions> {
  const chiMargin = options.chiMargin ?? defaults.chiMargin;
  const minChiHeadroom = options.minChiHeadroom ?? defaults.minChiHeadroom;
  if (!Number.isFinite(chiMargin) || chiMargin < 0) {
    throw new RangeError("chiMargin must be a finite non-negative number");
  }
  if (!Number.isSafeInteger(minChiHeadroom) || minChiHeadroom < 0) {
    throw new RangeError("minChiHeadroom must be a non-negative integer");
  }
  return { chiMargin, minChiHeadroom };
}

/** Return the chi to supply for a simulated `estimated` cost. */
export function suggestChiSupplied(estimated: number, options: ChiHeadroomOptions = {}): number {
  const { chiMargin, minChiHeadroom } = resolveChiHeadroom(options);
  if (!Number.isSafeInteger(estimated) || estimated < 0) {
    throw new RangeError("estimated chi must be a non-negative integer");
  }
  return estimated + Math.max(Math.ceil(estimated * chiMargin), minChiHeadroom);
}
