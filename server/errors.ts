/** Public errors contain fixed codes only, never token, database or save contents. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export function requireApi(condition: unknown, status: number, code: string): asserts condition {
  if (!condition) throw new ApiError(status, code);
}
