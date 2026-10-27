/**
 * Thrown for any non-2xx API response, network failure or timeout.
 *
 * `code` is the API's machine readable `error` field (for example
 * `insufficient_credits`). For responses without a JSON error body it is
 * `rate_limited` (429) or `http_error`; for network failures it is
 * `connection_error` and for timeouts `timeout`, both with `status` 0.
 */
export class SignYuError extends Error {
  readonly status: number;
  readonly code: string;
  /** Parsed response body, when there was one. */
  readonly body: unknown;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    body?: unknown;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = "SignYuError";
    this.status = opts.status;
    this.code = opts.code;
    this.body = opts.body;
    if (opts.cause !== undefined) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}

/** Thrown by `webhooks.constructEvent` when the signature does not match. */
export class WebhookSignatureError extends Error {
  constructor(message = "Webhook signature verification failed.") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}
