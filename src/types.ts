/**
 * Types mirroring the SignYu REST API (src/app/api/v1/** in the SignYu repo).
 * Timestamps are ISO 8601 strings as returned in JSON.
 */

/** Document lifecycle state. `PENDING` until sent, `SENT` while out for signature, `COMPLETED` when every signer has signed. */
export type DocumentStatus =
  | "PENDING"
  | "SENT"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  // Forward compatible with statuses added later.
  | (string & {});

/** One stamp rectangle in PDF points, origin at the bottom-left of the page. */
export interface SignaturePosition {
  /** 1-based page index. */
  page: number;
  /** Left edge in PDF points. */
  x: number;
  /** Bottom edge in PDF points (origin is bottom-left). */
  y: number;
  /** Box width in PDF points (minimum 140). */
  width: number;
  /** Box height in PDF points (minimum 110). */
  height: number;
}

export interface SignaturePlacement {
  /** One rectangle per page, 1 to 20 entries, pages must be distinct. */
  positions: SignaturePosition[];
}

export interface SignerAdvanced {
  signaturePlacement?: SignaturePlacement;
}

export interface SignerInput {
  /** Signer's full name. */
  name: string;
  /** Digits only, at least 10 characters. */
  phone: string;
  /** Valid email address. The signing link is emailed here. */
  email: string;
  /** Optional custom stamp placement. Omit to use the default fixed slot. */
  advanced?: SignerAdvanced;
}

/** Response of `POST /api/v1/documents`. */
export interface CreatedDocument {
  documentId: string;
  name: string;
  status: DocumentStatus;
  /** Effective reply-to address used for signer emails. */
  replyTo: string | null;
  /** `false` when SignYu sends no emails to signers for this document. */
  notifySigners: boolean;
  /** `false` when SignYu sends no completion email to the account owner. */
  notifyOwner: boolean;
}

export interface SignerCounts {
  total: number;
  signed: number;
}

export interface DocumentSummary {
  documentId: string;
  name: string;
  status: DocumentStatus;
  createdAt: string;
  signers: SignerCounts;
}

/** Response of `GET /api/v1/documents`. */
export interface DocumentList {
  documents: DocumentSummary[];
  limit: number;
  offset: number;
}

export interface DocumentSigner {
  signerId: string;
  name: string;
  email: string | null;
  phone: string;
  signingOrder: number;
  openedAt: string | null;
  signedAt: string | null;
  hasSigned: boolean;
  /** `null` until the document has been sent. */
  signUrl: string | null;
  advanced?: { signaturePlacement: SignaturePlacement };
}

/** Response of `GET /api/v1/documents/{documentId}`. */
export interface Document {
  documentId: string;
  name: string;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Temporary presigned link to the signed PDF, set once `COMPLETED`. */
  downloadUrl: string | null;
  /** Bearer-authenticated certificate endpoint, set once `COMPLETED`. */
  certificateUrl: string | null;
  /** Effective reply-to address used for signer emails. */
  replyTo: string | null;
  /** `false` when SignYu sends no emails to signers for this document. */
  notifySigners: boolean;
  /** `false` when SignYu sends no completion email to the account owner. */
  notifyOwner: boolean;
  signers: DocumentSigner[];
}

export interface AddedSigner {
  signerId: string;
  name: string;
  email: string | null;
  signingOrder: number;
  advanced?: { signaturePlacement: SignaturePlacement };
}

/** Response of `POST /api/v1/documents/{documentId}/signers`. */
export interface AddSignersResponse {
  signers: AddedSigner[];
}

export interface SentSigner {
  signerId: string;
  name: string;
  email: string | null;
  signingOrder: number;
  signUrl: string;
}

/** Response of `POST /api/v1/documents/{documentId}/send`. */
export interface SendDocumentResponse {
  documentId: string;
  status: "SENT";
  creditsRemaining: number;
  signers: SentSigner[];
}

/** Error body returned by every failing API call. */
export interface ApiErrorBody {
  error: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export type WebhookEventType = "signer.signed" | "document.completed";

export interface WebhookSigner {
  signerId: string;
  name: string;
  email: string | null;
  signingOrder: number;
  signedAt: string | null;
  hasSigned: boolean;
}

export interface SignerSignedEvent {
  event: "signer.signed";
  documentId: string;
  status: DocumentStatus;
  occurredAt: string;
  /** The signer who just signed. */
  signer: WebhookSigner | null;
  signers: WebhookSigner[];
}

export interface DocumentCompletedEvent {
  event: "document.completed";
  documentId: string;
  status: DocumentStatus;
  occurredAt: string;
  completedAt: string | null;
  certificateUrl: string;
  signers: WebhookSigner[];
}

export type WebhookEvent = SignerSignedEvent | DocumentCompletedEvent;
