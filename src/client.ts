import { SignYuError } from "./errors";
import { webhooks, type Webhooks } from "./webhooks";
import type {
  AddSignersResponse,
  CreatedDocument,
  Document,
  DocumentList,
  SendDocumentResponse,
  SignerInput,
} from "./types";
import { VERSION } from "./version";

export const DEFAULT_BASE_URL = "https://signyu.com";

export interface SignYuOptions {
  /** Your secret API key, `sk_live_...`. Keep it server side. */
  apiKey: string;
  /** Defaults to `https://signyu.com`. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Defaults to 60000. */
  timeoutMs?: number;
  /** Custom fetch implementation (defaults to the global `fetch`). */
  fetch?: typeof fetch;
}

export type FileInput = Blob | Uint8Array | ArrayBuffer;

export interface CreateDocumentParams {
  /** The PDF to sign, at most 10MB. A Node.js `Buffer` works here. */
  file: FileInput;
  /** File name sent with the upload. Defaults to `document.pdf`. */
  fileName?: string;
  /** Label for the document. Defaults to the file name. */
  name?: string;
  /**
   * Email address that receives signer replies to SignYu's signing emails.
   * Defaults to your account's reply-to setting, then your login email.
   */
  replyTo?: string;
}

export interface ListDocumentsParams {
  /** 1 to 100, default 20. */
  limit?: number;
  /** Default 0. */
  offset?: number;
}

interface RequestOptions {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: BodyInit;
  json?: unknown;
  expect?: "json" | "binary";
}

function toPdfBlob(file: FileInput): Blob {
  if (typeof Blob !== "undefined" && file instanceof Blob) {
    // The API rejects anything whose part type is not application/pdf.
    return file.type === "application/pdf"
      ? file
      : new Blob([file], { type: "application/pdf" });
  }
  if (file instanceof ArrayBuffer) {
    return new Blob([file], { type: "application/pdf" });
  }
  if (file instanceof Uint8Array) {
    // Copy into a plain ArrayBuffer-backed view so Blob accepts it everywhere.
    const copy = new Uint8Array(file.byteLength);
    copy.set(file);
    return new Blob([copy], { type: "application/pdf" });
  }
  throw new TypeError("file must be a Buffer, Uint8Array, ArrayBuffer or Blob.");
}

class Documents {
  constructor(private readonly client: SignYu) {}

  /** `POST /api/v1/documents`: upload a PDF and create a `PENDING` document. */
  create(params: CreateDocumentParams): Promise<CreatedDocument> {
    if (!params || params.file === undefined || params.file === null) {
      throw new TypeError("documents.create requires a `file`.");
    }
    const form = new FormData();
    form.append("file", toPdfBlob(params.file), params.fileName ?? "document.pdf");
    if (params.name !== undefined) form.append("name", params.name);
    if (params.replyTo !== undefined) form.append("replyTo", params.replyTo);
    return this.client._request<CreatedDocument>({
      method: "POST",
      path: "/api/v1/documents",
      body: form,
    });
  }

  /** `GET /api/v1/documents`: your documents, most recent first. */
  list(params: ListDocumentsParams = {}): Promise<DocumentList> {
    return this.client._request<DocumentList>({
      method: "GET",
      path: "/api/v1/documents",
      query: { limit: params.limit, offset: params.offset },
    });
  }

  /** `GET /api/v1/documents/{documentId}`: status and per-signer progress. */
  get(documentId: string): Promise<Document> {
    return this.client._request<Document>({
      method: "GET",
      path: `/api/v1/documents/${encodeURIComponent(documentId)}`,
    });
  }

  /** `POST /api/v1/documents/{documentId}/signers`: add signers while `PENDING` (max 6 per document). */
  addSigners(documentId: string, signers: SignerInput[]): Promise<AddSignersResponse> {
    return this.client._request<AddSignersResponse>({
      method: "POST",
      path: `/api/v1/documents/${encodeURIComponent(documentId)}/signers`,
      json: { signers },
    });
  }

  /**
   * `POST /api/v1/documents/{documentId}/send`: deducts one credit per signer,
   * emails signing links and returns them. Not idempotent: call it once.
   */
  send(documentId: string): Promise<SendDocumentResponse> {
    return this.client._request<SendDocumentResponse>({
      method: "POST",
      path: `/api/v1/documents/${encodeURIComponent(documentId)}/send`,
    });
  }

  /**
   * `GET /api/v1/documents/{documentId}/certificate`: the completion
   * certificate and audit trail PDF as raw bytes. Only available once the
   * document is `COMPLETED` (otherwise `409 invalid_state`).
   */
  getCertificate(documentId: string): Promise<Uint8Array> {
    return this.client._request<Uint8Array>({
      method: "GET",
      path: `/api/v1/documents/${encodeURIComponent(documentId)}/certificate`,
      expect: "binary",
    });
  }
}

export class SignYu {
  readonly documents: Documents;
  readonly webhooks: Webhooks = webhooks;
  readonly baseUrl: string;

  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SignYuOptions) {
    if (!options || !options.apiKey) {
      throw new TypeError("SignYu requires an `apiKey`.");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 60_000;
    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== "function") {
      throw new TypeError("No global fetch found. SignYu requires Node.js 18 or newer.");
    }
    this.fetchImpl = f;
    this.documents = new Documents(this);
  }

  /** @internal */
  async _request<T>(opts: RequestOptions): Promise<T> {
    const url = new URL(this.baseUrl + opts.path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: opts.expect === "binary" ? "application/pdf" : "application/json",
      "User-Agent": `signyu-node/${VERSION}`,
    };
    let body = opts.body;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method: opts.method,
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const isTimeout =
        err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new SignYuError({
        status: 0,
        code: isTimeout ? "timeout" : "connection_error",
        message: isTimeout
          ? `Request timed out after ${this.timeoutMs}ms.`
          : `Could not reach the SignYu API: ${err instanceof Error ? err.message : String(err)}`,
        cause: err,
      });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let parsed: unknown = undefined;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = text;
      }
      const errBody =
        parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      const code =
        typeof errBody.error === "string"
          ? errBody.error
          : res.status === 429
            ? "rate_limited"
            : "http_error";
      const message =
        typeof errBody.message === "string"
          ? errBody.message
          : `SignYu API request failed with status ${res.status}.`;
      throw new SignYuError({ status: res.status, code, message, body: parsed });
    }

    if (opts.expect === "binary") {
      return new Uint8Array(await res.arrayBuffer()) as T;
    }
    return (await res.json()) as T;
  }
}

export type { Documents };
