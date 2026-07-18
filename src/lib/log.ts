// Tiny structured logger for the dev-server terminal. Every pipeline stage
// (upload, parse, categorize, runs, insights) narrates through this so the
// terminal always shows what's happening — nothing fails silently.

function ts(): string {
  return new Date().toTimeString().slice(0, 8);
}

export function log(scope: string, msg: string, extra?: unknown) {
  if (extra !== undefined) {
    console.log(`[${ts()}] [${scope}] ${msg}`, extra);
  } else {
    console.log(`[${ts()}] [${scope}] ${msg}`);
  }
}

export function logError(scope: string, msg: string, err: unknown) {
  const detail =
    err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
  console.error(`[${ts()}] [${scope}] ERROR: ${msg}\n${detail}`);
}
