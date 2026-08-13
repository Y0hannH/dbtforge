import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { isTsqlAdapter, needsTopRewrite, rewriteWithTopLimit } from '../dbt/previewRewrite';
import { ShowTarget } from '../dbt/showCommand';
import { DbtShowCancelledError, DbtShowError, DbtShowRequest, runDbtShow } from '../dbt/showRunner';
import { DbtProjectIndex } from '../index/DbtProjectIndex';
import { DbtNode } from '../index/manifestTypes';
import { resolveAdapterType } from '../profiles/adapterType';
import { ProfileStore } from '../profiles/profileStore';
import { buildCtePreviewSql } from '../sql/ctePreview';
import { PreviewViewProvider } from './previewViewProvider';
import { describeTarget } from './previewState';

/** How a preview will be run, once the adapter's quirks have been taken into account. */
interface PreviewPlan {
  target: ShowTarget;
  /** The `--limit` handed to dbt; -1 when the limit is already carried by the SQL itself. */
  dbtRowLimit: number;
}

/**
 * Turns "preview this model" into a `dbt show` run and drives the panel through the states it
 * produces. Owns the in-flight run so that a second preview supersedes the first rather than
 * racing it — the panel shows one result at a time, so a stale run finishing later must not
 * overwrite a newer one.
 */
export class PreviewController implements vscode.Disposable {
  private inFlight: AbortController | undefined;
  private lastRun: (() => Promise<void>) | undefined;

  constructor(
    private readonly view: PreviewViewProvider,
    private readonly profileStore: ProfileStore,
    private readonly output: vscode.OutputChannel
  ) {}

  async previewModel(index: DbtProjectIndex, node: DbtNode): Promise<void> {
    const run = (): Promise<void> => this.run(index, node);
    this.lastRun = run;
    await run();
  }

  /** Previews one CTE of a model, by truncating the query just after that CTE. */
  async previewCte(index: DbtProjectIndex, node: DbtNode, cteName: string): Promise<void> {
    const run = (): Promise<void> => this.run(index, node, cteName);
    this.lastRun = run;
    await run();
  }

  /** Re-runs the last preview, for the panel's refresh action. */
  async rerun(): Promise<void> {
    if (!this.lastRun) {
      vscode.window.showInformationMessage('dbt Forge: nothing previewed yet.');
      return;
    }
    await this.lastRun();
  }

  private async run(index: DbtProjectIndex, node: DbtNode, cteName?: string): Promise<void> {
    const config = index.getConfig();
    const profileArgs = this.profileStore.toCliArgs(config.projectDir);
    const label = describeTarget(cteName ? `${node.name} › ${cteName}` : node.name, profileArgs);

    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    await this.view.reveal();
    this.view.setState({ kind: 'running', label });

    const startedAt = Date.now();
    try {
      const plan = await this.planPreview(index, node, config.previewRowLimit, cteName);
      if (this.isSuperseded(controller)) return;

      const table = await runDbtShow({
        pythonPath: config.pythonPath,
        projectDir: config.projectDir,
        profilesDir: config.profilesDir,
        profileArgs,
        rowLimit: plan.dbtRowLimit,
        target: plan.target,
        signal: controller.signal,
      });
      if (this.isSuperseded(controller)) return;

      this.view.setState({
        kind: 'result',
        label,
        table,
        rowLimit: config.previewRowLimit,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (error) {
      // A superseded run is also an aborted one, so the two can't be told apart by the error:
      // only the controller's identity says whether this run still owns the panel.
      if (this.isSuperseded(controller)) return;
      this.reportFailure(label, error);
    } finally {
      if (this.inFlight === controller) this.inFlight = undefined;
    }
  }

  /**
   * Decides how to run the preview. The ordinary path is `--select <model>`, which keeps the
   * model's own config (so `is_incremental()` and friends behave). The deviation below is entered
   * only for models that would otherwise fail outright, because `--inline` loses that config.
   */
  private async planPreview(
    index: DbtProjectIndex,
    node: DbtNode,
    rowLimit: number,
    cteName?: string
  ): Promise<PreviewPlan> {
    if (cteName) return this.planCtePreview(index, node, rowLimit, cteName);

    const ordinary: PreviewPlan = { target: { kind: 'node', name: node.name }, dbtRowLimit: rowLimit };
    if (rowLimit < 1) return ordinary; // no limit requested: dbt appends nothing to collide with

    const config = index.getConfig();
    const adapterType = await resolveAdapterType(
      config.projectDir,
      config.profilesDir,
      this.profileStore.get(config.projectDir)
    );
    if (!adapterType || !isTsqlAdapter(adapterType)) return ordinary;

    const sql = await readModelSql(index, node);
    if (!sql || !needsTopRewrite(sql)) return ordinary;

    const rewritten = rewriteWithTopLimit(sql, rowLimit);
    if (!rewritten) {
      // Understood enough to know it would fail, not enough to rewrite it safely. Running the
      // ordinary path surfaces dbt's real error instead of a query we can't vouch for.
      this.output.appendLine(
        `dbt Forge: ${node.name} uses SELECT DISTINCT, which dbt's limit clause breaks on ` +
          `${adapterType}, but its SQL could not be rewritten safely. Running it unchanged.`
      );
      return ordinary;
    }

    this.output.appendLine(
      `dbt Forge: previewing ${node.name} with an inline TOP ${rowLimit}, because dbt's ` +
        `${adapterType} limit clause is invalid on SELECT DISTINCT.`
    );
    return { target: { kind: 'inline', sql: rewritten }, dbtRowLimit: -1 };
  }

  /**
   * A CTE preview always goes through `--inline`, since the query being run doesn't exist as a
   * node. dbt's own `--limit` is safe here regardless of adapter: the generated final SELECT is
   * `select * from <cte>`, never DISTINCT, so the clause dbt-fabric appends has nothing to collide
   * with — the TOP rewrite is needed only for a model's own final SELECT.
   */
  private async planCtePreview(
    index: DbtProjectIndex,
    node: DbtNode,
    rowLimit: number,
    cteName: string
  ): Promise<PreviewPlan> {
    const modelSql = await readModelSql(index, node);
    if (!modelSql) {
      throw new DbtShowError(`could not read the source of "${node.name}" to preview its CTEs.`);
    }

    const sql = buildCtePreviewSql(modelSql, cteName);
    if (!sql) {
      throw new DbtShowError(
        `could not build a preview for CTE "${cteName}" — it is no longer in ${node.name}, or the ` +
          'query changed shape since the button was drawn. Save the file and try again.'
      );
    }

    return { target: { kind: 'inline', sql }, dbtRowLimit: rowLimit };
  }

  /** True once a newer preview has taken over the panel, making this run's outcome irrelevant. */
  private isSuperseded(controller: AbortController): boolean {
    return this.inFlight !== controller;
  }

  private reportFailure(label: string, error: unknown): void {
    if (error instanceof DbtShowCancelledError) {
      this.view.setState({ kind: 'idle' });
      return;
    }

    if (error instanceof DbtShowError) {
      // The short message goes in the panel; dbt's own output goes to the channel, where it can be
      // read in full without the grid having to become a log viewer.
      if (error.details) {
        this.output.appendLine(`dbt Forge: preview of ${label} failed.`);
        this.output.appendLine(error.details);
      }
      this.view.setState({
        kind: 'error',
        label,
        message: error.details ? `${error.message}\n\n${error.details}` : error.message,
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    this.output.appendLine(`dbt Forge: preview of ${label} failed: ${message}`);
    this.view.setState({ kind: 'error', label, message });
  }

  cancel(): void {
    this.inFlight?.abort();
  }

  dispose(): void {
    this.inFlight?.abort();
  }
}

/** The model's source SQL, Jinja included — `--inline` compiles it, so refs still resolve. */
async function readModelSql(index: DbtProjectIndex, node: DbtNode): Promise<string | undefined> {
  try {
    return await fs.readFile(index.getFileUri(node).fsPath, 'utf8');
  } catch {
    return undefined;
  }
}
