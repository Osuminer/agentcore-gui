import { execReal, registerRun, type ExecSpec, type Run } from './run';
import { execMock, isMock } from './mock';

/** `key` (usually the project directory) lets callers detect a still-running command via activeRunForKey. */
export function startExec(spec: ExecSpec, display: string, key?: string): Run {
  const run = isMock() ? execMock(spec, display) : execReal(spec, display);
  registerRun(run, key);
  return run;
}
export { isMock };
