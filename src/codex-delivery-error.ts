import { AitermError } from "./errors.js";

export class CodexDeliveryError extends AitermError {
  constructor(readonly delivery_code: string, message: string, readonly outcome_unknown = false) {
    super(`${delivery_code}: ${message}`, 2);
  }
}
