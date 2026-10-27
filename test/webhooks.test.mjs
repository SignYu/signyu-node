import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  computeSignature,
  constructEvent,
  verifySignature,
  WebhookSignatureError,
  SIGNATURE_HEADER,
  SignYu,
} from "../dist/index.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/webhook.json", import.meta.url), "utf8")
);

test("signature matches the server-generated fixture", () => {
  assert.equal(computeSignature(fixture.body, fixture.secret), fixture.header);
  assert.equal(verifySignature(fixture.body, fixture.header, fixture.secret), true);
  assert.equal(
    verifySignature(Buffer.from(fixture.body), fixture.header, fixture.secret),
    true
  );
  assert.equal(SIGNATURE_HEADER, "X-SignSetu-Signature");
});

test("rejects tampered body, wrong secret, bad or missing header", () => {
  assert.equal(verifySignature(fixture.body + " ", fixture.header, fixture.secret), false);
  assert.equal(verifySignature(fixture.body, fixture.header, "whsec_wrong"), false);
  assert.equal(verifySignature(fixture.body, "sha256=abc", fixture.secret), false);
  assert.equal(verifySignature(fixture.body, undefined, fixture.secret), false);
  assert.equal(
    verifySignature(fixture.body, fixture.header.replace("sha256=", ""), fixture.secret),
    false
  );
});

test("constructEvent parses verified payloads and throws otherwise", () => {
  const event = constructEvent(fixture.body, fixture.header, fixture.secret);
  assert.equal(event.event, "document.completed");
  assert.equal(event.signers[0].signerId, "s_1");
  assert.throws(
    () => constructEvent(fixture.body, "sha256=00", fixture.secret),
    WebhookSignatureError
  );
});

test("webhooks are reachable from a client instance", () => {
  const client = new SignYu({ apiKey: "sk_live_test" });
  assert.equal(client.webhooks.verifySignature(fixture.body, fixture.header, fixture.secret), true);
});

test("CommonJS build exposes the same API", () => {
  const require = createRequire(import.meta.url);
  const cjs = require("../dist/index.cjs");
  assert.equal(typeof cjs.SignYu, "function");
  assert.equal(cjs.verifySignature(fixture.body, fixture.header, fixture.secret), true);
});
