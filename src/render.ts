import type { ResultEnvelope } from "./protocol.js";

function renderTarget(envelope: ResultEnvelope<unknown>): string | null {
  const target = envelope.meta.target;
  if (!target?.title && !target?.url) {
    return null;
  }
  const title = target.title ? `Target: ${target.title}` : null;
  const url = target.url ? `URL: ${target.url}` : null;
  return [title, url].filter(Boolean).join("\n");
}

export function renderEnvelope(envelope: ResultEnvelope<unknown>): string {
  const lines: string[] = [];

  if (envelope.ok) {
    const body = envelope.data === undefined ? "" : JSON.stringify(envelope.data, null, 2);
    if (body) {
      lines.push(body);
    }
  } else {
    lines.push(`Error [${envelope.code}] ${envelope.error?.message ?? "Unknown error"}`);
    if (envelope.hint?.nextSteps?.length) {
      lines.push("");
      lines.push("Next steps:");
      for (const step of envelope.hint.nextSteps) {
        lines.push(`- ${step}`);
      }
    }
  }

  const target = renderTarget(envelope);
  if (target) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(target);
  }

  if (lines.length > 0) {
    lines.push("");
  }
  lines.push(`[${envelope.code} | ${envelope.meta.durationMs}ms]`);
  return lines.join("\n");
}
