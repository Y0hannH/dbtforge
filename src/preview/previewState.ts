import { PreviewTable } from '../dbt/showOutput';

/** What the preview panel is showing. Serialized straight into the webview on every change. */
export type PreviewState =
  | { kind: 'idle' }
  | { kind: 'running'; label: string }
  | { kind: 'error'; label: string; message: string }
  | {
      kind: 'result';
      label: string;
      table: PreviewTable;
      /** The `--limit` the rows were fetched with; -1 when every row was asked for. */
      rowLimit: number;
      elapsedMs: number;
    };

/** Describes what was previewed and against which environment, e.g. "stg_customers · target: dev". */
export function describeTarget(name: string, profileArgs: string[]): string {
  if (profileArgs.length === 0) return name;

  const environment: string[] = [];
  for (let i = 0; i < profileArgs.length - 1; i += 2) {
    environment.push(`${profileArgs[i].replace(/^--/, '')}: ${profileArgs[i + 1]}`);
  }
  return `${name} · ${environment.join(', ')}`;
}
