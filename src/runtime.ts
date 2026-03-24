import { evaluateInTarget, listTargets, resolveTarget, captureFetchInTarget, type CapturedRequest, type TargetInfo, type TargetSelector } from "./cdp.js";
import { Browser2CliError, okResult, type ResultEnvelope } from "./protocol.js";

export async function waitForTarget(params: {
  endpoint: string;
  selector: TargetSelector;
  timeoutMs: number;
  pollMs?: number;
}): Promise<TargetInfo> {
  const startedAt = Date.now();
  const pollMs = params.pollMs ?? 250;

  while (Date.now() - startedAt < params.timeoutMs) {
    const targets = await listTargets(params.endpoint);
    try {
      return resolveTarget(targets, params.selector);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Could not resolve a unique target")) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Browser2CliError({
    code: "TARGET_NOT_FOUND",
    state: "target_not_found",
    message: "Target page did not appear before timeout.",
    retryable: true,
    phase: "locate",
    details: {
      selector: params.selector,
      timeoutMs: params.timeoutMs
    },
    nextSteps: ["请先打开目标页面，或补充更精确的 --url-contains / --target-id 条件。"]
  });
}

export async function waitForPageReady(params: {
  target: TargetInfo;
  readyExpression: string;
  timeoutMs: number;
  pollMs?: number;
}): Promise<ResultEnvelope<{ ready: true }>> {
  const startedAt = Date.now();
  const pollMs = params.pollMs ?? 250;
  while (Date.now() - startedAt < params.timeoutMs) {
    const result = await evaluateInTarget(params.target, params.readyExpression);
    if (Boolean(result)) {
      return okResult({
        command: "wait-page-ready",
        durationMs: Date.now() - startedAt,
        phase: "ensurePage",
        target: params.target,
        data: { ready: true }
      });
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Browser2CliError({
    code: "PAGE_NOT_READY",
    state: "page_not_ready",
    message: "Target page did not become ready before timeout.",
    retryable: true,
    phase: "ensurePage",
    details: {
      timeoutMs: params.timeoutMs
    },
    nextSteps: ["请确认页面已经加载完成，或放宽 ready 条件后重试。"]
  });
}

export async function detectState(params: {
  target: TargetInfo;
  loginExpression?: string;
  readyExpression?: string;
}): Promise<ResultEnvelope<{ state: string }>> {
  const startedAt = Date.now();
  if (params.loginExpression) {
    const loginRequired = Boolean(await evaluateInTarget(params.target, params.loginExpression));
    if (loginRequired) {
      return {
        ok: false,
        code: "LOGIN_REQUIRED",
        state: "login_required",
        error: {
          message: "Current page requires login.",
          retryable: true
        },
        hint: {
          nextSteps: ["请先登录目标站点，再重新执行当前命令。"]
        },
        meta: {
          command: "detect-state",
          phase: "ensureAuth",
          durationMs: Date.now() - startedAt,
          target: params.target
        }
      };
    }
  }

  if (params.readyExpression) {
    const ready = Boolean(await evaluateInTarget(params.target, params.readyExpression));
    if (!ready) {
      return {
        ok: false,
        code: "PAGE_NOT_READY",
        state: "page_not_ready",
        error: {
          message: "Current page is not ready.",
          retryable: true
        },
        hint: {
          nextSteps: ["请等待页面稳定，或调用 wait-page-ready。"]
        },
        meta: {
          command: "detect-state",
          phase: "ensurePage",
          durationMs: Date.now() - startedAt,
          target: params.target
        }
      };
    }
  }

  return okResult({
    command: "detect-state",
    durationMs: Date.now() - startedAt,
    target: params.target,
    data: { state: "ok" }
  });
}

function pickMatchingRequest(requests: CapturedRequest[], matcher: string): CapturedRequest | null {
  return requests.find((request) => request.url.includes(matcher)) ?? null;
}

export async function captureUntil(params: {
  target: TargetInfo;
  triggerExpression?: string;
  matchUrlContains: string;
  timeoutMs: number;
}): Promise<ResultEnvelope<{ request: CapturedRequest }>> {
  const startedAt = Date.now();
  const requests = await captureFetchInTarget(params.target, {
    triggerExpression: params.triggerExpression,
    waitMs: params.timeoutMs
  });

  const match = pickMatchingRequest(requests, params.matchUrlContains);
  if (!match) {
    throw new Browser2CliError({
      code: "CAPTURE_TIMEOUT",
      state: "capture_timeout",
      message: "Did not capture a matching network request before timeout.",
      retryable: true,
      phase: "collect",
      details: {
        matchUrlContains: params.matchUrlContains,
        timeoutMs: params.timeoutMs
      },
      nextSteps: ["请确认触发动作会发出目标请求，或放宽 match 规则。"]
    });
  }

  return okResult({
    command: "capture-until",
    durationMs: Date.now() - startedAt,
    phase: "collect",
    target: params.target,
    data: { request: match }
  });
}
