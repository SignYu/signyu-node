# SignYu Node.js SDK

Official Node.js SDK for the [SignYu](https://signyu.com) Aadhaar eSign API. Upload a PDF, add signers, and send it for legally valid Aadhaar OTP based eSignature under the IT Act 2000, all from your backend.

- Zero runtime dependencies (uses the built-in `fetch`, `FormData` and `Blob`)
- ESM and CommonJS builds with full TypeScript types
- Webhook signature verification with constant time comparison

API docs: https://signyu.com/docs. API overview and pricing: https://signyu.com/api (signatures from ₹15 each on credit packs of 10 or more).

## Install

```bash
npm install signyu
```

Requires Node.js 18 or newer.

## Quickstart

```ts
import { readFileSync } from "node:fs";
import { SignYu } from "signyu";

const signyu = new SignYu({ apiKey: process.env.SIGNYU_API_KEY! });

// 1. Upload the PDF
const doc = await signyu.documents.create({
  file: readFileSync("agreement.pdf"),
  fileName: "agreement.pdf",
  name: "Service Agreement",
});

// 2. Add signers (they sign in this order, up to 6 per document)
await signyu.documents.addSigners(doc.documentId, [
  { name: "Asha Rao", phone: "9876543210", email: "asha@example.com" },
  { name: "Vikram Nair", phone: "9812345678", email: "vikram@example.com" },
]);

// 3. Send: deducts one credit per signer and emails each signer a link
const sent = await signyu.documents.send(doc.documentId);
console.log(sent.signers.map((s) => s.signUrl));

// 4. Check progress (or use webhooks)
const status = await signyu.documents.get(doc.documentId);
console.log(status.status); // PENDING, SENT or COMPLETED
```

CommonJS works too: `const { SignYu } = require("signyu");`

Get your API key from the dashboard under Developers (https://signyu.com/app/developers). Keep it on your server and never ship it to a browser.

## Configuration

```ts
const signyu = new SignYu({
  apiKey: "sk_live_...",          // required
  baseUrl: "https://signyu.com",  // optional
  timeoutMs: 60_000,              // optional, per request
  fetch: customFetch,             // optional, defaults to globalThis.fetch
});
```

## Methods

### `documents.create({ file, fileName?, name?, replyTo?, notifySigners?, notifyOwner? })`

`POST /api/v1/documents`. Uploads a PDF (at most 10MB) and creates a document in `PENDING` state. `file` can be a `Buffer`, `Uint8Array`, `ArrayBuffer` or `Blob`. It is always sent as `application/pdf`. `fileName` defaults to `document.pdf`, and `name` defaults to the file name.

`replyTo` is an email address that receives signer replies to SignYu's signing emails (signature request, completion). If omitted, SignYu uses your account's reply-to setting (dashboard Settings), then your login email. An invalid address fails with `400 invalid_request`.

```ts
const doc = await signyu.documents.create({
  file: readFileSync("agreement.pdf"),
  replyTo: "legal@example.com",
});
console.log(doc.replyTo); // "legal@example.com"
```

`notifySigners: false` stops SignYu emailing signers for this document: no signing-request email and no completion email. Send each signer the `signUrl` (returned by `documents.send` and `documents.get`) from your own system instead. Signers can still download their signed copy on the signing page. `notifyOwner: false` stops the completion email to you, the account owner; use webhooks or `documents.get` instead. Both default to `true`.

```ts
const doc = await signyu.documents.create({
  file: readFileSync("agreement.pdf"),
  notifySigners: false,
  notifyOwner: false,
});
```

Returns `{ documentId, name, status, replyTo, notifySigners, notifyOwner }`.

### `documents.list({ limit?, offset? })`

`GET /api/v1/documents`. Your documents, most recent first. `limit` is 1 to 100 (default 20), `offset` defaults to 0.

Returns `{ documents: [{ documentId, name, status, createdAt, signers: { total, signed } }], limit, offset }`.

### `documents.get(documentId)`

`GET /api/v1/documents/{documentId}`. Status and per-signer progress. Once `COMPLETED`, `downloadUrl` is a temporary presigned link to the signed PDF and `certificateUrl` points at the certificate endpoint. Each signer's `signUrl` is `null` until the document is sent. `replyTo` is the effective reply-to address used for signer emails.

### `documents.addSigners(documentId, signers)`

`POST /api/v1/documents/{documentId}/signers`. Only while the document is `PENDING`. Each signer needs `name`, `phone` (digits only, at least 10) and `email`. At most 6 signers per document.

Optional custom stamp placement (PDF points, origin at the bottom-left of the page, box at least 140 x 110, one box per page):

```ts
await signyu.documents.addSigners(documentId, [
  {
    name: "Asha Rao",
    phone: "9876543210",
    email: "asha@example.com",
    advanced: {
      signaturePlacement: {
        positions: [{ page: 2, x: 31, y: 257, width: 253, height: 110 }],
      },
    },
  },
]);
```

Returns `{ signers: [{ signerId, name, email, signingOrder, advanced? }] }`.

### `documents.send(documentId)`

`POST /api/v1/documents/{documentId}/send`. Deducts one credit per signer, marks the document `SENT`, emails each signer a signing link and returns the links. Call it once per document.

Returns `{ documentId, status: "SENT", creditsRemaining, signers: [{ signerId, name, email, signingOrder, signUrl }] }`.

### `documents.getCertificate(documentId)`

`GET /api/v1/documents/{documentId}/certificate`. Returns the completion certificate and audit trail PDF as a `Uint8Array`. Only available once the document is `COMPLETED`, otherwise it throws a `SignYuError` with code `invalid_state` (409).

```ts
import { writeFileSync } from "node:fs";
writeFileSync("certificate.pdf", await signyu.documents.getCertificate(documentId));
```

## Webhooks

SignYu sends `signer.signed` and `document.completed` events as a JSON `POST`. Each request carries an `X-SignSetu-Signature: sha256=<hex>` header, an HMAC-SHA256 of the raw request body keyed with your endpoint's signing secret (`whsec_...`, shown in the dashboard). Always verify against the raw body bytes, not a re-serialized object.

```ts
import express from "express";
import { SignYu, WebhookSignatureError } from "signyu";

const signyu = new SignYu({ apiKey: process.env.SIGNYU_API_KEY! });
const app = express();

app.post("/webhooks/signyu", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const event = signyu.webhooks.constructEvent(
      req.body, // Buffer
      req.header("X-SignSetu-Signature"),
      process.env.SIGNYU_WEBHOOK_SECRET!
    );
    if (event.event === "document.completed") {
      // event.certificateUrl, event.signers ...
    }
    res.sendStatus(200);
  } catch (err) {
    if (err instanceof WebhookSignatureError) return res.sendStatus(400);
    throw err;
  }
});
```

The same helpers are exported directly: `verifySignature(rawBody, header, secret)` returns a boolean, and `constructEvent(rawBody, header, secret)` returns the typed event or throws `WebhookSignatureError`. Deliveries can repeat, so make your handler idempotent.

## Errors

Every non-2xx response throws a `SignYuError`:

```ts
import { SignYuError } from "signyu";

try {
  await signyu.documents.send(documentId);
} catch (err) {
  if (err instanceof SignYuError) {
    console.log(err.status);  // 402
    console.log(err.code);    // "insufficient_credits"
    console.log(err.message); // "You need 2 credits to send this document."
  }
}
```

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_content_type`, `invalid_request`, `invalid_file`, `no_signers`, `signer_limit_reached` | The request is invalid. |
| 401 | `unauthorized` | Missing or invalid API key. |
| 402 | `insufficient_credits` | Not enough credits to send. |
| 403 | `api_access_not_enabled` | The account has no API access subscription. |
| 404 | `not_found` | The document does not exist or is not yours. |
| 409 | `invalid_state` | Not allowed in the document's current state. |
| 413 | `file_too_large` | The PDF is over 10MB. |
| 429 | `rate_limited` | Too many requests, retry with backoff. |
| 500 | `internal_error` | Something went wrong on our side. |
| 0 | `connection_error`, `timeout` | The request never got a response. |

Retry `429` and `5xx` with backoff. Do not blindly retry `send`, since a successful send that timed out on your side would charge credits again.

## Links

- Docs: https://signyu.com/docs
- API: https://signyu.com/api
- OpenAPI spec: https://signyu.com/openapi.yaml
- Support: contact@mail.signyu.com

## License

MIT
