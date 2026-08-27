/**
 * Types shared between operator route actions (server) and the components
 * that render their results (client). Kept out of `operator.server.ts` so no
 * client module ever imports a server-only file.
 */

export interface OperatorParameterError {
  field: string;
  message: string;
}

export interface OperatorActionResult {
  ok: boolean;
  intent: string;
  message: string;
  errors?: OperatorParameterError[];
  runId?: string;
  detail?: string[];
}
