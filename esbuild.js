const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const extensionCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'info',
  });

  // Bundled separately (browser target, no `vscode` external) because it runs inside the
  // webview's iframe, not the extension host. Ships React + React Flow + dagre locally —
  // no CDN, per the "100% local, no third-party service" requirement.
  const webviewCtx = await esbuild.context({
    entryPoints: ['src/webview/lineageFlowWebview.tsx'],
    bundle: true,
    format: 'iife',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    jsx: 'automatic',
    outfile: 'dist/webview/lineage.js',
    logLevel: 'info',
  });

  if (watch) {
    await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
  } else {
    await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
    await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
