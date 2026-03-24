import { evaluateInTarget, type TargetInfo } from "../cdp.js";
import { Browser2CliError } from "../protocol.js";
import type { AdapterContext, LifecycleAdapter } from "../registry.js";
import { detectState } from "../runtime.js";

type ShushuContext = AdapterContext & {
  target: TargetInfo;
};

export const shushuProjectRowAdapter: LifecycleAdapter = {
  name: "shushu-project-row",
  site: "shushu",
  description: "从已打开的数数项目页读取一条结构化项目数据。",
  input: ["--endpoint", "--target-id | --url-contains | --title-contains", "--row-expr", "--login-expr?", "--ready-expr?"],
  output: ["row"],
  states: [
    "ok",
    "login_required",
    "target_not_found",
    "multiple_targets",
    "page_not_ready",
    "data_empty",
    "eval_error",
    "internal_error"
  ],
  prerequisites: ["数数项目页面已打开，且 row-expr 能返回结构化对象。"],
  loginRequired: true,
  reusableSession: true,
  lifecycle: ["locate", "ensureAuth", "ensurePage", "collect", "normalize"],
  async locate(args) {
    const target = args.__pickedTarget as unknown as TargetInfo | undefined;
    if (!target) {
      throw new Browser2CliError({
        code: "TARGET_NOT_FOUND",
        state: "target_not_found",
        message: "No selected target was provided for shushu-project-row.",
        retryable: true,
        phase: "locate",
        nextSteps: ["请先通过 target 选择参数定位到数数项目页面。"]
      });
    }
    return { args, target };
  },
  async ensureAuth(ctx) {
    const typedCtx = ctx as ShushuContext;
    const loginExpression = typedCtx.args["login-expr"] as string | undefined;
    if (!loginExpression) {
      return typedCtx;
    }
    const state = await detectState({
      target: typedCtx.target,
      loginExpression
    });
    if (!state.ok) {
      throw new Browser2CliError({
        code: state.code,
        state: state.state,
        message: state.error?.message ?? "Current page requires login.",
        retryable: state.error?.retryable ?? true,
        phase: "ensureAuth",
        details: state.error?.details,
        nextSteps: state.hint?.nextSteps
      });
    }
    return typedCtx;
  },
  async ensurePage(ctx) {
    const typedCtx = ctx as ShushuContext;
    const readyExpression = typedCtx.args["ready-expr"] as string | undefined;
    if (!readyExpression) {
      return typedCtx;
    }
    const state = await detectState({
      target: typedCtx.target,
      readyExpression
    });
    if (!state.ok) {
      throw new Browser2CliError({
        code: state.code,
        state: state.state,
        message: state.error?.message ?? "Current page is not ready.",
        retryable: state.error?.retryable ?? true,
        phase: "ensurePage",
        details: state.error?.details,
        nextSteps: state.hint?.nextSteps
      });
    }
    return typedCtx;
  },
  async collect(ctx) {
    const typedCtx = ctx as ShushuContext;
    const rowExpression = typedCtx.args["row-expr"] as string | undefined;
    if (!rowExpression) {
      throw new Browser2CliError({
        code: "INVALID_ARGUMENT",
        state: "invalid_argument",
        message: "Missing required argument --row-expr",
        retryable: false,
        phase: "collect",
        nextSteps: ["请补充 --row-expr 后重试。"]
      });
    }
    return evaluateInTarget(typedCtx.target, rowExpression);
  },
  async normalize(raw) {
    if (!raw || (typeof raw === "object" && Array.isArray(raw) && raw.length === 0)) {
      throw new Browser2CliError({
        code: "DATA_EMPTY",
        state: "data_empty",
        message: "No row data was returned from the current page.",
        retryable: true,
        phase: "normalize",
        nextSteps: ["请确认 row-expr 能返回目标项目数据，或检查页面是否已经加载完成。"]
      });
    }
    return { row: raw };
  }
};
