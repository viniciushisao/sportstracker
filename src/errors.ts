export class JobError extends Error {
  constructor(public code: string, message: string, public stage = 'validation') { super(message); }
}
export function assert(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new JobError(code, message);
}
// Unexpected library errors may contain SMTP credentials or source contents. Never log their messages.
export function safeError(error: unknown): { code: string; message: string; stage: string } {
  return error instanceof JobError ? { code: error.code, message: error.message, stage: error.stage }
    : { code: 'UNEXPECTED', message: 'Unexpected failure; inspect the failing stage and configuration.', stage: 'runtime' };
}
