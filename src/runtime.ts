import { evaluateInTarget, listTargets, openTarget, resolveTarget, captureFetchInTarget, typeTextInTarget, type CapturedRequest, type TargetInfo, type TargetSelector } from "./cdp.js";
import { Browser2CliError, okResult, type ResultEnvelope } from "./protocol.js";

export type FormFieldSpec = {
  selector: string;
  value: string;
  transforms?: string[];
};

function applyFieldTransforms(value: string, transforms?: string[]): string {
  let next = value;
  for (const transform of transforms ?? []) {
    switch (transform) {
      case "trim":
        next = next.trim();
        break;
      case "strip-mailto":
        next = next.replace(/^mailto:/i, "");
        break;
      default:
        break;
    }
  }
  return next;
}

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

export async function ensureOpen(params: {
  endpoint: string;
  url: string;
  selector: TargetSelector;
  timeoutMs: number;
  pollMs?: number;
}): Promise<TargetInfo> {
  try {
    return await waitForTarget({
      endpoint: params.endpoint,
      selector: params.selector,
      timeoutMs: params.timeoutMs,
      pollMs: params.pollMs
    });
  } catch (error) {
    if (!(error instanceof Browser2CliError) || error.code !== "TARGET_NOT_FOUND") {
      throw error;
    }
  }

  await openTarget(params.endpoint, params.url);

  return waitForTarget({
    endpoint: params.endpoint,
    selector: params.selector,
    timeoutMs: params.timeoutMs,
    pollMs: params.pollMs
  });
}

export async function retryOpen(params: {
  open: () => Promise<TargetInfo>;
  retries: number;
  delayMs?: number;
}): Promise<TargetInfo> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= params.retries; attempt += 1) {
    try {
      return await params.open();
    } catch (error) {
      lastError = error;
      if (attempt === params.retries) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, params.delayMs ?? 250));
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Browser2CliError({
    code: "ACTION_FAILED",
    state: "action_failed",
    message: `Open action failed after retries: ${message}`,
    retryable: false,
    phase: "locate",
    details: { retries: params.retries },
    nextSteps: ["请检查页面 URL、CDP endpoint 和浏览器状态后重试。"]
  });
}

export async function invokeAction(params: {
  target: TargetInfo;
  expression: string;
  readyExpression?: string;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<ResultEnvelope<{ result: unknown }>> {
  const startedAt = Date.now();
  const result = await evaluateInTarget(params.target, params.expression);

  if (params.readyExpression) {
    await waitForPageReady({
      target: params.target,
      readyExpression: params.readyExpression,
      timeoutMs: params.timeoutMs ?? 5_000,
      pollMs: params.pollMs
    });
  }

  return okResult({
    command: "invoke-action",
    durationMs: Date.now() - startedAt,
    phase: "collect",
    target: params.target,
    data: { result }
  });
}

function buildSubmitFormExpression(submitSelector?: string): string {
  const spec = JSON.stringify({ submitSelector: submitSelector ?? null });
  return `(() => {
    const __BROWSER2CLI_SUBMIT_FORM__ = true;
    const spec = ${spec};
    const missing = [];
    let submitted = false;
    let submitTarget = null;
    let form = null;

    if (spec.submitSelector) {
      submitTarget = document.querySelector(spec.submitSelector);
      if (!submitTarget) {
        missing.push(spec.submitSelector);
      }
    }

    if (submitTarget instanceof HTMLButtonElement || submitTarget instanceof HTMLInputElement) {
      form = submitTarget.form ?? submitTarget.closest('form');
    } else if (submitTarget instanceof HTMLElement) {
      form = submitTarget.closest('form');
    }

    if (!submitTarget && !form) {
      form = document.querySelector('form');
    }

    if (!submitTarget && form instanceof HTMLFormElement) {
      submitTarget = form.querySelector('input[type="submit"], button[type="submit"]');
    }

    if (submitTarget instanceof HTMLElement) {
      submitTarget.click();
      submitted = true;
    } else if (form instanceof HTMLFormElement && typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      submitted = true;
    } else if (form instanceof HTMLFormElement) {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.submit();
      submitted = true;
    }

    return {
      submitted,
      missing,
      submitSelector: spec.submitSelector
    };
  })()`;
}

export async function fillForm(params: {
  target: TargetInfo;
  fields: FormFieldSpec[];
}): Promise<ResultEnvelope<{ filled: string[]; missing: string[]; fieldCount: number }>> {
  const startedAt = Date.now();
  const filled: string[] = [];
  const missing: string[] = [];
  for (const field of params.fields) {
    const result = await typeTextInTarget(
      params.target,
      field.selector,
      applyFieldTransforms(field.value, field.transforms)
    );
    if (!result.ok) {
      missing.push(field.selector);
      continue;
    }
    filled.push(field.selector);
  }
  if (missing.length > 0) {
    throw new Browser2CliError({
      code: "ACTION_FAILED",
      state: "action_failed",
      message: "Some form fields could not be located.",
      retryable: true,
      phase: "collect",
      details: {
        missing,
        requested: params.fields.map((field) => field.selector)
      },
      nextSteps: ["请确认字段 selector 正确，或先等待登录表单渲染完成。"]
    });
  }

  return okResult({
    command: "fill-form",
    durationMs: Date.now() - startedAt,
    phase: "collect",
    target: params.target,
    data: {
      filled,
      missing,
      fieldCount: params.fields.length
    }
  });
}

export async function submitForm(params: {
  target: TargetInfo;
  fields?: FormFieldSpec[];
  submitSelector?: string;
  readyExpression?: string;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<ResultEnvelope<{ submitted: boolean; submitCount?: number; fieldCount?: number }>> {
  const startedAt = Date.now();

  let fieldCount: number | undefined;
  if (params.fields?.length) {
    const fillResult = await fillForm({
      target: params.target,
      fields: params.fields
    });
    fieldCount = fillResult.data?.fieldCount;
  }

  const submitResult = await evaluateInTarget(params.target, buildSubmitFormExpression(params.submitSelector)) as {
    submitted?: boolean;
    missing?: string[];
    submitCount?: number;
  } | null;

  const missing = submitResult?.missing ?? [];
  if (missing.length > 0) {
    throw new Browser2CliError({
      code: "ACTION_FAILED",
      state: "action_failed",
      message: "Submit target could not be located.",
      retryable: true,
      phase: "collect",
      details: { missing, submitSelector: params.submitSelector },
      nextSteps: ["请确认提交按钮 selector 正确，或改为让表单自行 requestSubmit。"]
    });
  }

  if (!submitResult?.submitted) {
    throw new Browser2CliError({
      code: "ACTION_FAILED",
      state: "action_failed",
      message: "Form submission did not start.",
      retryable: true,
      phase: "collect",
      details: { submitSelector: params.submitSelector },
      nextSteps: ["请检查页面是否已完成校验，或确认表单存在可提交的按钮/表单节点。"]
    });
  }

  if (params.readyExpression) {
    await waitForPageReady({
      target: params.target,
      readyExpression: params.readyExpression,
      timeoutMs: params.timeoutMs ?? 5_000,
      pollMs: params.pollMs
    });
  }

  return okResult({
    command: "submit-form",
    durationMs: Date.now() - startedAt,
    phase: "collect",
    target: params.target,
    data: {
      submitted: true,
      submitCount: submitResult.submitCount,
      fieldCount
    }
  });
}
