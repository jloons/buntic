/**
 * Standardized console logging and error formatting utilities for Buntic.
 */

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function logWarn(message: string, label = "Buntic Warning"): void {
  console.warn(`\x1b[33m⚠ [${label}]\x1b[0m ${message}`);
}

export function logError(message: string, err?: unknown, label = "Buntic Error"): void {
  if (err !== undefined) {
    console.error(`\x1b[31m[${label}]\x1b[0m ${message}:`, getErrorMessage(err));
  } else {
    console.error(`\x1b[31m[${label}]\x1b[0m ${message}`);
  }
}
