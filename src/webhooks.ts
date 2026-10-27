import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookSignatureError } from "./errors";
import type { WebhookEvent } from "./types";

/** Header carrying the signature, `sha256=<hex>`. */
export const SIGNATURE_HEADER = "X-SignSetu-Signature";
/** Header carrying the event type, for example `signer.signed`. */
export const EVENT_HEADER = "X-SignSetu-Event";

export type WebhookPayload = string | Uint8Array | ArrayBuffer;

function toBuffer(payload: WebhookPayload): Buffer {
  if (typeof payload === "string") return Buffer.from(payload, "utf8");
  if (payload instanceof ArrayBuffer) return Buffer.from(new Uint8Array(payload));
  return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
}

/** Computes the `sha256=<hex>` header value SignYu sends for a raw body. */
export function computeSignature(payload: WebhookPayload, secret: string): string {
  const hex = createHmac("sha256", secret).update(toBuffer(payload)).digest("hex");
  return `sha256=${hex}`;
}

/**
 * Returns true when `signatureHeader` (the `X-SignSetu-Signature` value) is a
 * valid HMAC-SHA256 of the raw request body under `secret`. Pass the raw body
 * bytes exactly as received; a re-serialized object will not match.
 * Comparison is constant time.
 */
export function verifySignature(
  payload: WebhookPayload,
  signatureHeader: string | null | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = Buffer.from(computeSignature(payload, secret), "utf8");
  const received = Buffer.from(signatureHeader.trim(), "utf8");
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

/**
 * Verifies the signature and returns the parsed event. Throws
 * `WebhookSignatureError` if the signature is missing or invalid.
 */
export function constructEvent(
  payload: WebhookPayload,
  signatureHeader: string | null | undefined,
  secret: string
): WebhookEvent {
  if (!verifySignature(payload, signatureHeader, secret)) {
    throw new WebhookSignatureError();
  }
  return JSON.parse(toBuffer(payload).toString("utf8")) as WebhookEvent;
}

export const webhooks = {
  SIGNATURE_HEADER,
  EVENT_HEADER,
  computeSignature,
  verifySignature,
  constructEvent,
};

export type Webhooks = typeof webhooks;
