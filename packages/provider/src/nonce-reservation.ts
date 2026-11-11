import { NonceReservationManager as SharedNonceReservations } from "@xian-tech/types/internal/nonce-reservation";
import { ProviderNonceReservationError } from "./errors.js";

export type { NonceReservation, NonceScope } from "@xian-tech/types/internal/nonce-reservation";

/** Preserve the package's public error types around shared coordination. */
export class NonceReservationManager extends SharedNonceReservations {
  constructor() {
    super({
      invalidNonce: (message) => new TypeError(message),
      unresolved: (options) => new ProviderNonceReservationError(options)
    });
  }
}
