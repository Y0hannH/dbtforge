import { getNonce } from '../webview/nonce';

// The panel's markup, styles and rendering script, inlined rather than bundled: a results grid
// needs no framework, and the extension already ships React once for the lineage view. Keeping
// this one dependency-free is why the whole panel costs a single HTML string.
//
// Cells are written with textContent, never innerHTML — values come back from the warehouse and
// have no business being parsed as markup.

/** Beyond this, building DOM rows costs more than anyone gains from scrolling them. */
const MAX_RENDERED_ROWS = 2000;

export function renderPreviewHtml(): string {
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <style>${STYLES}</style>
</head>
<body>
  <div id="status"></div>
  <div id="grid"></div>
  <script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}

const STYLES = `
  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
  }
  body { display: flex; flex-direction: column; }

  #status {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 5px 10px;
    border-bottom: 1px solid var(--vscode-panel-border, #454545);
    white-space: nowrap;
    flex: 0 0 auto;
  }
  .label { font-weight: 600; }
  .muted { color: var(--vscode-descriptionForeground); }
  .grow { flex: 1 1 auto; }

  button {
    font-family: inherit;
    font-size: inherit;
    color: var(--vscode-button-secondaryForeground, inherit);
    background: var(--vscode-button-secondaryBackground, transparent);
    border: 1px solid var(--vscode-panel-border, #454545);
    border-radius: 2px;
    padding: 1px 10px;
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground, transparent); }

  #grid { flex: 1 1 auto; overflow: auto; }

  .message {
    padding: 10px;
    white-space: pre-wrap;
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-errorForeground);
  }
  .hint { padding: 10px; color: var(--vscode-descriptionForeground); white-space: pre-wrap; }

  table { border-collapse: collapse; font-family: var(--vscode-editor-font-family, monospace); }
  th, td {
    padding: 2px 10px;
    text-align: left;
    border-right: 1px solid var(--vscode-panel-border, #454545);
    border-bottom: 1px solid var(--vscode-panel-border, #454545);
    max-width: 480px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  th {
    position: sticky;
    top: 0;
    z-index: 1;
    font-weight: 600;
    background: var(--vscode-editorWidget-background, #252526);
  }
  tbody tr:hover { background: var(--vscode-list-hoverBackground, transparent); }
  td.num { text-align: right; }
  .null { color: var(--vscode-descriptionForeground); font-style: italic; }
`;

const SCRIPT = `
  const vscode = acquireVsCodeApi();
  const statusEl = document.getElementById('status');
  const gridEl = document.getElementById('grid');
  const MAX_RENDERED_ROWS = ${MAX_RENDERED_ROWS};

  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'state') render(event.data.state);
  });

  function render(state) {
    statusEl.replaceChildren();
    gridEl.replaceChildren();

    if (state.kind === 'idle') {
      gridEl.append(hint('Open a dbt model, then run "dbt Forge: Preview Data".'));
      return;
    }

    statusEl.append(span('label', state.label));

    if (state.kind === 'running') {
      statusEl.append(span('muted grow', 'Running dbt show\\u2026'));
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
      statusEl.append(cancel);
      return;
    }

    if (state.kind === 'error') {
      gridEl.append(message(state.message));
      return;
    }

    const rowCount = state.table.rows.length;
    statusEl.append(span('muted', rowCount === 1 ? '1 row' : rowCount + ' rows'));
    // Hitting the limit exactly is the one case where the user can't tell whether they are looking
    // at the whole result, so it is called out rather than left to be inferred from the row count.
    if (state.rowLimit > 0 && rowCount >= state.rowLimit) {
      statusEl.append(span('muted', '(limit reached)'));
    }
    statusEl.append(span('muted grow', Math.round(state.elapsedMs) + ' ms'));

    if (state.table.columns.length === 0) {
      gridEl.append(hint('The query returned no rows.'));
      return;
    }

    gridEl.append(buildTable(state.table));
    if (rowCount > MAX_RENDERED_ROWS) {
      gridEl.append(hint('Showing the first ' + MAX_RENDERED_ROWS + ' of ' + rowCount + ' rows.'));
    }
  }

  function buildTable(table) {
    const el = document.createElement('table');

    const headRow = document.createElement('tr');
    for (const column of table.columns) {
      const th = document.createElement('th');
      th.textContent = column;
      th.title = column;
      headRow.append(th);
    }
    const thead = document.createElement('thead');
    thead.append(headRow);
    el.append(thead);

    const tbody = document.createElement('tbody');
    for (const row of table.rows.slice(0, MAX_RENDERED_ROWS)) {
      const tr = document.createElement('tr');
      for (const value of row) {
        tr.append(buildCell(value));
      }
      tbody.append(tr);
    }
    el.append(tbody);

    return el;
  }

  function buildCell(value) {
    const td = document.createElement('td');
    if (value === null) {
      const nullEl = document.createElement('span');
      nullEl.className = 'null';
      nullEl.textContent = 'NULL';
      td.append(nullEl);
      return td;
    }

    if (typeof value === 'number') td.className = 'num';
    td.textContent = String(value);
    td.title = String(value); // the full value, for anything the column width clipped
    return td;
  }

  function span(className, text) {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    return el;
  }

  function hint(text) { return span('hint', text); }
  function message(text) { return span('message', text); }

  vscode.postMessage({ type: 'ready' });
`;
