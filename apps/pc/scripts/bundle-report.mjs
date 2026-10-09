import path from 'node:path';

/** Build-only module ownership manifest. Never imported by the application.
 * @param {'main'|'renderer'} target
 * @returns {import('vite').Plugin}
 */
export function bundleReport(target) {
  let root = '';
  let mode = '';
  return {
    name: 'novel-editor-bundle-report',
    configResolved(config) {
      root = path.resolve(config.root, '../..').replaceAll('\\', '/');
      mode = config.mode;
    },
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((output) => output.type === 'chunk');
      const files = new Set(chunks.map((chunk) => chunk.fileName));
      this.emitFile({
        type: 'asset',
        fileName: `bundle-${target}.json`,
        source: JSON.stringify(
          {
            version: 1,
            target,
            mode,
            chunks: chunks.map((chunk) => ({
              file: chunk.fileName,
              entry: chunk.isEntry,
              imports: chunk.imports.filter((file) => files.has(file)),
              externalImports: chunk.imports.filter((file) => !files.has(file)),
              dynamicImports: chunk.dynamicImports.filter((file) => files.has(file)),
              modules: Object.keys(chunk.modules).map((id) => {
                const normalized = id.replaceAll('\\', '/');
                return normalized.startsWith(`${root}/`)
                  ? normalized.slice(root.length + 1)
                  : normalized;
              }),
            })),
          },
          null,
          2
        ),
      });
    },
  };
}
