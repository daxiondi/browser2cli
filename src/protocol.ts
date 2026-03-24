export type Browser2CliCode =
  | "OK"
  | "INVALID_ARGUMENT"
  | "TARGET_NOT_FOUND"
  | "MULTIPLE_TARGETS"
  | "CDP_CONNECT_FAILED"
  | "LOGIN_REQUIRED"
  | "PAGE_NOT_READY"
  | "REPORT_NOT_SELECTED"
  | "DATA_EMPTY"
  | "ACTION_FAILED"
  | "CAPTURE_TIMEOUT"
  | "NETWORK_ERROR"
  | "EVAL_ERROR"
  | "INTERNAL_ERROR";

export type Browser2CliState =
  | "ok"
  | "invalid_argument"
  | "target_not_found"
  | "multiple_targets"
  | "cdp_connect_failed"
  | "login_required"
  | "page_not_ready"
  | "report_not_selected"
  | "data_empty"
  | "action_failed"
  | "capture_timeout"
  | "network_error"
  | "eval_error"
  | "internal_error";

export type Phase = "locate" | "ensureAuth" | "ensurePage" | "collect" | "normalize";

export type ResultEnvelope<T> = {
  ok: boolean;
  code: Browser2CliCode;
  state: Browser2CliState;
  data?: T;
  error?: {
    message: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  };
  hint?: {
    nextSteps?: string[];
  };
  meta: {
    command: string;
    adapter?: string;
    phase?: Phase;
    durationMs: number;
    target?: {
      id?: string;
      title?: string;
      url?: string;
    };
    truncated?: boolean;
  };
};

export class Browser2CliError extends Error {
  readonly code: Browser2CliCode;
  readonly state: Browser2CliState;
  readonly retryable: boolean;
  readonly phase?: Phase;
  readonly details?: Record<string, unknown>;
  readonly nextSteps?: string[];

  constructor(params: {
    code: Browser2CliCode;
    state: Browser2CliState;
    message: string;
    retryable?: boolean;
    phase?: Phase;
    details?: Record<string, unknown>;
    nextSteps?: string[];
  }) {
    super(params.message);
    this.name = "Browser2CliError";
    this.code = params.code;
    this.state = params.state;
    this.retryable = params.retryable ?? false;
    this.phase = params.phase;
    this.details = params.details;
    this.nextSteps = params.nextSteps;
  }
}

type BaseResultParams = {
  command: string;
  adapter?: string;
  phase?: Phase;
  durationMs: number;
  target?: {
    id?: string;
    title?: string;
    url?: string;
  };
  truncated?: boolean;
};

export function okResult<T>(params: BaseResultParams & { data: T }): ResultEnvelope<T> {
  return {
    ok: true,
    code: "OK",
    state: "ok",
    data: params.data,
    meta: {
      command: params.command,
      adapter: params.adapter,
      phase: params.phase,
      durationMs: params.durationMs,
      target: params.target,
      truncated: params.truncated
    }
  };
}

export function errorResult(params: BaseResultParams & {
  code: Browser2CliCode;
  state: Browser2CliState;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
  nextSteps?: string[];
}): ResultEnvelope<never> {
  return {
    ok: false,
    code: params.code,
    state: params.state,
    error: {
      message: params.message,
      retryable: params.retryable,
      details: params.details
    },
    hint: params.nextSteps?.length ? { nextSteps: params.nextSteps } : undefined,
    meta: {
      command: params.command,
      adapter: params.adapter,
      phase: params.phase,
      durationMs: params.durationMs,
      target: params.target,
      truncated: params.truncated
    }
  };
}

export function normalizeThrownError(
  error: unknown,
  params: BaseResultParams & {
    fallbackCode?: Browser2CliCode;
    fallbackState?: Browser2CliState;
    nextSteps?: string[];
  }
): ResultEnvelope<never> {
  if (error instanceof Browser2CliError) {
    return errorResult({
      ...params,
      code: error.code,
      state: error.state,
      message: error.message,
      retryable: error.retryable,
      details: error.details,
      nextSteps: error.nextSteps ?? params.nextSteps
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  return errorResult({
    ...params,
    code: params.fallbackCode ?? "INTERNAL_ERROR",
    state: params.fallbackState ?? "internal_error",
    message,
    retryable: false,
    nextSteps: params.nextSteps
  });
}
