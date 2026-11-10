import { test } from "node:test";
import assert from "node:assert/strict";
import { SignYu, SignYuError } from "../dist/index.js";

// Never hits the network: every request goes through this mock fetch.
function mockFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init);
  };
  fn.calls = calls;
  return fn;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("requires an apiKey", () => {
  assert.throws(() => new SignYu({}), TypeError);
});

test("documents.create sends multipart with an application/pdf file part", async () => {
  const fetch = mockFetch(() =>
    json({ documentId: "doc_1", name: "Service Agreement", status: "PENDING" }, 201)
  );
  const client = new SignYu({ apiKey: "sk_live_abc", fetch });
  const pdf = Buffer.from("%PDF-1.4 test");
  const res = await client.documents.create({
    file: pdf,
    fileName: "agreement.pdf",
    name: "Service Agreement",
  });

  assert.deepEqual(res, { documentId: "doc_1", name: "Service Agreement", status: "PENDING" });
  const { url, init } = fetch.calls[0];
  assert.equal(url, "https://signyu.com/api/v1/documents");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer sk_live_abc");
  assert.equal(init.headers["Content-Type"], undefined, "fetch must set the multipart boundary");
  assert.ok(init.body instanceof FormData);
  const file = init.body.get("file");
  assert.equal(file.type, "application/pdf");
  assert.equal(file.name, "agreement.pdf");
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(), "%PDF-1.4 test");
  assert.equal(init.body.get("name"), "Service Agreement");
});

test("documents.create re-types a Blob that is not application/pdf", async () => {
  const fetch = mockFetch(() => json({ documentId: "d", name: "x", status: "PENDING" }, 201));
  const client = new SignYu({ apiKey: "k", fetch });
  await client.documents.create({ file: new Blob(["%PDF"]) });
  const file = fetch.calls[0].init.body.get("file");
  assert.equal(file.type, "application/pdf");
  assert.equal(file.name, "document.pdf");
  assert.equal(fetch.calls[0].init.body.get("name"), null);
});

test("documents.create sends replyTo only when provided and parses the response", async () => {
  const fetch = mockFetch(() =>
    json({ documentId: "d", name: "x", status: "PENDING", replyTo: "legal@example.com" }, 201)
  );
  const client = new SignYu({ apiKey: "k", fetch });
  const res = await client.documents.create({ file: Buffer.from("%PDF"), replyTo: "legal@example.com" });
  assert.equal(res.replyTo, "legal@example.com");
  assert.equal(fetch.calls[0].init.body.get("replyTo"), "legal@example.com");

  await client.documents.create({ file: Buffer.from("%PDF") });
  assert.equal(fetch.calls[1].init.body.has("replyTo"), false);
});

test("documents.create sends notifySigners/notifyOwner as 'true'/'false' only when provided", async () => {
  const fetch = mockFetch(() =>
    json(
      { documentId: "d", name: "x", status: "PENDING", replyTo: null, notifySigners: false, notifyOwner: false },
      201
    )
  );
  const client = new SignYu({ apiKey: "k", fetch });
  const res = await client.documents.create({
    file: Buffer.from("%PDF"),
    notifySigners: false,
    notifyOwner: false,
  });
  assert.equal(res.notifySigners, false);
  assert.equal(res.notifyOwner, false);
  assert.equal(fetch.calls[0].init.body.get("notifySigners"), "false");
  assert.equal(fetch.calls[0].init.body.get("notifyOwner"), "false");

  await client.documents.create({ file: Buffer.from("%PDF"), notifySigners: true });
  assert.equal(fetch.calls[1].init.body.get("notifySigners"), "true");
  assert.equal(fetch.calls[1].init.body.has("notifyOwner"), false);

  await client.documents.create({ file: Buffer.from("%PDF") });
  assert.equal(fetch.calls[2].init.body.has("notifySigners"), false);
  assert.equal(fetch.calls[2].init.body.has("notifyOwner"), false);
});

test("documents.get parses replyTo", async () => {
  const fetch = mockFetch(() =>
    json({ documentId: "d", name: "x", status: "PENDING", replyTo: null, signers: [] })
  );
  const client = new SignYu({ apiKey: "k", fetch });
  const res = await client.documents.get("d");
  assert.equal(res.replyTo, null);
});

test("list builds query params and honours a custom baseUrl", async () => {
  const fetch = mockFetch(() => json({ documents: [], limit: 5, offset: 10 }));
  const client = new SignYu({ apiKey: "k", baseUrl: "http://localhost:3000/", fetch });
  await client.documents.list({ limit: 5, offset: 10 });
  assert.equal(fetch.calls[0].url, "http://localhost:3000/api/v1/documents?limit=5&offset=10");
  assert.equal(fetch.calls[0].init.method, "GET");

  await client.documents.list();
  assert.equal(fetch.calls[1].url, "http://localhost:3000/api/v1/documents");
});

test("get, addSigners, send hit the right URLs with the right bodies", async () => {
  const fetch = mockFetch(() => json({ ok: true }));
  const client = new SignYu({ apiKey: "k", fetch });

  await client.documents.get("doc 1");
  assert.equal(fetch.calls[0].url, "https://signyu.com/api/v1/documents/doc%201");

  const signers = [
    { name: "Asha Rao", phone: "9876543210", email: "asha@example.com" },
    {
      name: "Vikram Nair",
      phone: "9812345678",
      email: "vikram@example.com",
      advanced: {
        signaturePlacement: { positions: [{ page: 1, x: 31, y: 239, width: 253, height: 110 }] },
      },
    },
  ];
  await client.documents.addSigners("doc_1", signers);
  const add = fetch.calls[1];
  assert.equal(add.url, "https://signyu.com/api/v1/documents/doc_1/signers");
  assert.equal(add.init.method, "POST");
  assert.equal(add.init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(add.init.body), { signers });

  await client.documents.send("doc_1");
  const send = fetch.calls[2];
  assert.equal(send.url, "https://signyu.com/api/v1/documents/doc_1/send");
  assert.equal(send.init.method, "POST");
  assert.equal(send.init.body, undefined);
});

test("getCertificate returns raw PDF bytes", async () => {
  const fetch = mockFetch(
    () => new Response(new Uint8Array([37, 80, 68, 70]), { headers: { "Content-Type": "application/pdf" } })
  );
  const client = new SignYu({ apiKey: "k", fetch });
  const bytes = await client.documents.getCertificate("doc_1");
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(Buffer.from(bytes).toString(), "%PDF");
  assert.equal(fetch.calls[0].url, "https://signyu.com/api/v1/documents/doc_1/certificate");
});

test("API errors become SignYuError with status, code and message", async () => {
  const fetch = mockFetch(() =>
    json({ error: "insufficient_credits", message: "You need 2 credits to send this document." }, 402)
  );
  const client = new SignYu({ apiKey: "k", fetch });
  await assert.rejects(client.documents.send("doc_1"), (err) => {
    assert.ok(err instanceof SignYuError);
    assert.equal(err.status, 402);
    assert.equal(err.code, "insufficient_credits");
    assert.equal(err.message, "You need 2 credits to send this document.");
    return true;
  });
});

test("non-JSON 429 maps to rate_limited", async () => {
  const fetch = mockFetch(() => new Response("Too Many Requests", { status: 429 }));
  const client = new SignYu({ apiKey: "k", fetch });
  await assert.rejects(client.documents.list(), (err) => {
    assert.equal(err.status, 429);
    assert.equal(err.code, "rate_limited");
    return true;
  });
});

test("network failures become connection_error", async () => {
  const fetch = mockFetch(() => {
    throw new TypeError("fetch failed");
  });
  const client = new SignYu({ apiKey: "k", fetch });
  await assert.rejects(client.documents.get("x"), (err) => {
    assert.ok(err instanceof SignYuError);
    assert.equal(err.status, 0);
    assert.equal(err.code, "connection_error");
    return true;
  });
});
