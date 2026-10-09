import {
  runSqlMesh,
  type RunSqlMeshOptions,
  type SqlMeshRun,
  type TransformTarget,
} from './run-sqlmesh.ts';

export type TransformToolOptions = RunSqlMeshOptions;
export type TransformToolRun = SqlMeshRun;

/**
 * OUTSIDE THE JOB CONTRACT (Plan C): the transformation tool's own command line, for a person at a
 * development machine — still through the platform (the lakehouse is checked first, the secrets
 * reach that process only), but never in the orchestrator nor in CI, which use the verbs
 * (`runTransformJob`). Its arguments and output belong to the tool and change with it.
 */
export function runTransformTool(
  target: TransformTarget,
  args: readonly string[],
  options: TransformToolOptions = {},
): Promise<TransformToolRun> {
  return runSqlMesh(target, args, options);
}
