import { execReal, registerRun, type ExecSpec, type Run } from './run';
import { execMock, isMock } from './mock';

export function startExec(spec: ExecSpec, display: string): Run {
  const run = isMock() ? execMock(spec, display) : execReal(spec, display);
  registerRun(run);
  return run;
}
export { isMock };
