export type DiscoveryErrorCode =
  | "location_not_found"
  | "malformed_response"
  | "provider_timeout"
  | "rate_limited"
  | "provider_server_error"
  | "provider_request_failed"
  | "unsupported_category"
  | "unsupported_source";

export class DiscoverySourceError extends Error {
  readonly code: DiscoveryErrorCode;
  readonly source: string;
  readonly status: number | null;

  constructor(code: DiscoveryErrorCode, source: string, message: string, status: number | null = null) {
    super(message);
    this.name = "DiscoverySourceError";
    this.code = code;
    this.source = source;
    this.status = status;
  }
}
