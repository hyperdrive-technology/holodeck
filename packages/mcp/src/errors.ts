/** A refusal the agent can act on: `problems` lists everything wrong at once. */
export class ToolError extends Error {
  constructor(
    message: string,
    public readonly problems: readonly string[] = [],
    /** Short machine-readable reason (`not_found`, `invalid_document`, `conflict`, ...). */
    public readonly code: string = 'invalid_request',
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
