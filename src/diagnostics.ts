export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  try {
    return String(error);
  } catch {
    return 'Unknown error';
  }
}

export function logError(message: string, context: Record<string, unknown>): void {
  console.error(`[tabbed] ${message}`, context);
}
