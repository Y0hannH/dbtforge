import * as fs from 'fs';
import * as path from 'path';

// dbt-core has no `__main__.py`, so `python -m dbt` always fails with
// "No module named dbt.__main__; 'dbt' is a package and cannot be directly executed" —
// the venv's own `dbt` script (installed next to python.exe via its console-script entry
// point) has to be invoked directly instead.
export function resolveDbtExecutable(pythonPath: string): string | undefined {
  if (!pythonPath) return 'dbt'; // no venv configured: fall back to PATH

  const scriptsDir = path.dirname(pythonPath);
  const candidate = path.join(scriptsDir, process.platform === 'win32' ? 'dbt.exe' : 'dbt');
  return fs.existsSync(candidate) ? candidate : undefined;
}
