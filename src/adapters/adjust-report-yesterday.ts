import { captureFetchInTarget, type CapturedRequest, type TargetInfo } from "../cdp.js";
import type { Args } from "../args.js";
import { Browser2CliError, okResult } from "../protocol.js";

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (!match) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function getRowDate(row: Record<string, unknown>): string | null {
  for (const key of ["day", "date", "date_label", "dateLabel", "dimension_day"]) {
    const normalized = normalizeDate(row[key]);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export function selectPivotReport(requests: CapturedRequest[]): CapturedRequest {
  const match = [...requests]
    .reverse()
    .find((item) => item.url.includes("reports-service/pivot_report") && !item.error && (item.status ?? 200) < 400);

  if (!match) {
    throw new Error("No successful pivot_report response was captured.");
  }
  return match;
}

export function extractRowsForDate(response: unknown, targetDate: string): Record<string, unknown>[] {
  if (!response || typeof response !== "object") {
    return [];
  }

  const rows = (response as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.filter((row): row is Record<string, unknown> => {
    if (!row || typeof row !== "object") {
      return false;
    }
    return getRowDate(row) === targetDate;
  });
}

export function resolveTargetDate(args: Args): string {
  if (args.date) {
    return args.date;
  }
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return now.toISOString().slice(0, 10);
}

export async function runAdjustReportYesterday(target: TargetInfo, args: Args) {
  const startedAt = Date.now();
  const targetDate = resolveTargetDate(args);
  const requests = await captureFetchInTarget(target, {
    triggerExpression: args["trigger-expr"] ?? args.triggerExpr,
    waitMs: args["wait-ms"] ? Number(args["wait-ms"]) : undefined
  });
  const pivotRequest = selectPivotReport(requests);
  const rows = extractRowsForDate(pivotRequest.response, targetDate);

  if (rows.length === 0) {
    throw new Browser2CliError({
      code: "DATA_EMPTY",
      state: "data_empty",
      message: `No rows found for date ${targetDate}.`,
      retryable: true,
      phase: "normalize",
      details: {
        date: targetDate,
        requestUrl: pivotRequest.url
      },
      nextSteps: ["请确认报表接口返回了目标日期的数据，或显式指定 --date 后重试。"]
    });
  }

  return okResult({
    command: "run",
    adapter: "adjust-report-yesterday",
    durationMs: Date.now() - startedAt,
    phase: "normalize",
    target,
    data: {
      date: targetDate,
      request: {
        url: pivotRequest.url,
        method: pivotRequest.method,
        status: pivotRequest.status ?? null
      },
      rowCount: rows.length,
      rows
    }
  });
}
