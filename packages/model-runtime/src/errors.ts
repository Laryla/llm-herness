export type ModelErrorCode =
  | "authentication_failed"
  | "invalid_request"
  | "model_not_found"
  | "rate_limited"
  | "upstream_unavailable"
  | "stream_interrupted"
  | "cancelled";

/** 对调用方暴露稳定且脱敏的错误，不携带供应商响应正文或 API Key。 */
export class ModelError extends Error {
  constructor(
    readonly code: ModelErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ModelError";
  }
}
