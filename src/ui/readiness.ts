import { reviewModelText } from "../engine/operations";
import { SAMPLE_EDIT } from "../engine/sample";
import { createWorkbook } from "../engine/types";

export interface ReadinessIssue {
  code: string;
  title: string;
  fix: string;
}

export interface ClientReadiness {
  ok: boolean;
  issues: ReadinessIssue[];
  helperUp: boolean;
  engineOk: boolean;
}

export function checkEngineLocally(): boolean {
  const review = reviewModelText(SAMPLE_EDIT, createWorkbook(), null);
  return review.ok;
}

export async function runClientReadiness(fetchImpl: typeof fetch = fetch): Promise<ClientReadiness> {
  const issues: ReadinessIssue[] = [];
  let helperUp = false;
  const engineOk = checkEngineLocally();
  if (!engineOk) {
    issues.push({
      code: "engine",
      title: "Built-in edit check failed",
      fix: "Reload the page. If it persists, reinstall dependencies and run tests.",
    });
  }
  try {
    const health = await fetchImpl("/api/health");
    helperUp = health.ok;
    if (!helperUp) {
      issues.push({
        code: "helper",
        title: "File helper is not running",
        fix: "Run `npm run dev:all` from the project folder, then reload.",
      });
    }
  } catch {
    issues.push({
      code: "helper",
      title: "File helper is not running",
      fix: "Run `npm run dev:all` from the project folder, then reload.",
    });
  }
  let serverOk = false;
  if (helperUp) {
    try {
      const ready = await fetchImpl("/api/ready");
      if (ready.ok) {
        const body = (await ready.json()) as { ok?: boolean; issues?: ReadinessIssue[] };
        serverOk = Boolean(body.ok);
        if (Array.isArray(body.issues)) {
          for (const issue of body.issues) {
            if (!issues.some((existing) => existing.code === issue.code)) issues.push(issue);
          }
        }
      } else {
        issues.push({
          code: "ready_failed",
          title: "Setup check failed",
          fix: "Check the toolbar model and provider, then click Retry setup.",
        });
      }
    } catch {
      issues.push({
        code: "ready_failed",
        title: "Setup check failed",
        fix: "Check the toolbar model and provider, then click Retry setup.",
      });
    }
  }
  const ok = engineOk && helperUp && serverOk && issues.length === 0;
  return { ok, issues: ok ? [] : issues, helperUp, engineOk };
}
