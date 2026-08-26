export function formatError(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return 'Unknown error';
  }
}

export function logError(message: string, context: Record<string, unknown>): void {
  console.error(`[tabbed] ${message}`, context);
}
