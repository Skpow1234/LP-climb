export type GithubContribErrorCode =
  | "INVALID_USERNAME"
  | "USER_NOT_FOUND"
  | "BAD_CREDENTIALS"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_BAD_RESPONSE";

export class GithubContribError extends Error {
  readonly code: GithubContribErrorCode;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;
  override readonly cause?: unknown;

  constructor(params: {
    code: GithubContribErrorCode;
    message: string;
    statusCode: number;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "GithubContribError";
    this.code = params.code;
    this.statusCode = params.statusCode;
    if (params.details !== undefined) this.details = params.details;
    if (params.cause !== undefined) this.cause = params.cause;
  }
}

export function isGithubContribError(e: unknown): e is GithubContribError {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as any).name === "GithubContribError" &&
    typeof (e as any).code === "string" &&
    typeof (e as any).statusCode === "number"
  );
}

