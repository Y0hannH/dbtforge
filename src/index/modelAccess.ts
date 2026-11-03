import type { DbtNode } from './manifestTypes';

/**
 * The `access` rule dbt enforces on `ref()`: a `private` model can only be referenced from a model in
 * the same group. `protected` (the default) and `public` models are open to the whole project, and
 * crossing a project boundary is a separate rule that this does not look at.
 *
 * Returns the warning to show on the `ref()`, or undefined when there is nothing to say. It stays
 * silent whenever it cannot be sure: a caller that is not a model in the manifest (just created, or a
 * test or analysis whose treatment is dbt's to decide) is never flagged.
 */
export function privateRefWarning(
  target: DbtNode,
  caller: DbtNode | undefined,
): string | undefined {
  if (target.access !== 'private') return undefined;
  if (!caller || caller.resource_type !== 'model') return undefined;

  const targetGroup = target.group || undefined;
  const callerGroup = caller.group || undefined;
  if (callerGroup !== undefined && callerGroup === targetGroup) return undefined;

  const subject = `"${target.name}" is private`;
  const owner = targetGroup ? ` to group "${targetGroup}"` : ' and belongs to no group';
  const here = callerGroup
    ? `this model is in group "${callerGroup}"`
    : 'this model is in no group';
  return `${subject}${owner}, so only models of its group can ref() it; ${here}.`;
}
