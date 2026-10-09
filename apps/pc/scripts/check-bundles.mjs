import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

/** @typedef {{file: string, entry: boolean, imports: string[], externalImports: string[], modules: string[]}} Chunk */
/** @typedef {Chunk & {bytes: number, gzip: number}} MeasuredChunk */

const limits = { mainStartup: 800_000, rendererStartup: 1_100_000, markdownPreview: 1_400_000 };
const heavyRenderer = ['katex', 'three', 'hls.js', 'dashjs', 'mpegts.js', 'pdfjs-dist'];
const deferredDialogs = [
  'AppSettingsCenter/index.tsx',
  'ShortcutsHelp/index.tsx',
  'AboutDialog/index.tsx',
  'RightPanel/AIAssistantDialog.tsx',
  'InspirationDialog/index.tsx',
  'EditorGrowthRecord/index.tsx',
  'KnowledgeExportDialog/index.tsx',
];

/** @param {unknown} value @returns {value is string[]} */
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

/** @param {string} directory @param {'main'|'renderer'} target */
async function loadGraph(directory, target) {
  const raw = JSON.parse(await readFile(path.join(directory, `bundle-${target}.json`), 'utf8'));
  if (
    raw.version !== 1 ||
    raw.mode !== 'production' ||
    raw.target !== target ||
    !Array.isArray(raw.chunks)
  ) {
    throw new Error(`Invalid production bundle report: ${target}`);
  }
  /** @type {Map<string, MeasuredChunk>} */
  const graph = new Map();
  for (const c of raw.chunks) {
    if (
      !c ||
      typeof c.file !== 'string' ||
      typeof c.entry !== 'boolean' ||
      !strings(c.imports) ||
      !strings(c.externalImports) ||
      !strings(c.modules) ||
      graph.has(c.file) ||
      path.isAbsolute(c.file) ||
      c.file.split(/[/\\]/).includes('..')
    ) {
      throw new Error(`Invalid chunk in ${target} report`);
    }
    const code = await readFile(path.join(directory, c.file));
    graph.set(c.file, { ...c, bytes: code.length, gzip: gzipSync(code).length });
  }
  if (![...graph.values()].some((c) => c.entry)) throw new Error(`Missing ${target} entry`);
  for (const c of graph.values())
    for (const dependency of c.imports) {
      if (!graph.has(dependency)) throw new Error(`Missing chunk: ${dependency} (from ${c.file})`);
    }
  return graph;
}

/** @param {Map<string, MeasuredChunk>} graph @param {string[]} roots */
function closure(graph, roots) {
  const seen = new Set();
  /** @param {string} file */
  const visit = (file) => {
    if (seen.has(file)) return;
    const chunk = graph.get(file);
    if (!chunk) throw new Error(`Unknown entry chunk: ${file}`);
    seen.add(file);
    chunk.imports.forEach(visit);
  };
  roots.forEach(visit);
  return [...seen].map((file) => /** @type {MeasuredChunk} */ (graph.get(file)));
}

/** @param {Map<string, MeasuredChunk>} graph @param {string} module */
function containing(graph, module) {
  const matches = [...graph.values()].filter((c) => c.modules.includes(module));
  if (matches.length !== 1)
    throw new Error(`Expected one chunk containing ${module}, got ${matches.length}`);
  return matches[0].file;
}

/** Inspect actual output bytes and transitive static imports; filenames may change freely.
 * These are JS dependency budgets, not timing measurements; CSS, preload and dynamic calls
 * executed during startup require the Electron integration tests as well.
 * @param {string} directory
 */
export async function checkBundleBudget(directory) {
  const [main, renderer] = await Promise.all([
    loadGraph(directory, 'main'),
    loadGraph(directory, 'renderer'),
  ]);
  const groups = {
    mainStartup: closure(
      main,
      [...main.values()].filter((c) => c.entry).map((c) => c.file)
    ),
    rendererStartup: closure(renderer, [
      ...[...renderer.values()].filter((c) => c.entry).map((c) => c.file),
      containing(renderer, 'apps/pc/src/render/App.tsx'),
    ]),
    markdownPreview: closure(renderer, [
      containing(renderer, 'apps/pc/src/render/components/TextEditor/live-preview/index.ts'),
    ]),
  };
  /** @type {string[]} */
  const errors = [];
  const metrics = Object.fromEntries(
    Object.entries(groups).map(([name, chunks]) => {
      const bytes = chunks.reduce((total, c) => total + c.bytes, 0);
      const gzip = chunks.reduce((total, c) => total + c.gzip, 0);
      const budget = limits[/** @type {keyof typeof limits} */ (name)];
      if (bytes > budget) errors.push(`${name}: ${bytes} bytes exceeds ${budget}`);
      const packages =
        name === 'mainStartup' ? ['docx', 'exceljs', 'mammoth', 'pptxgenjs'] : heavyRenderer;
      for (const c of chunks) {
        for (const external of c.externalImports ?? []) {
          const normalizedExternal = external.replaceAll('\\', '/');
          if (
            packages.some(
              (pkg) =>
                normalizedExternal === pkg ||
                normalizedExternal.startsWith(`${pkg}/`) ||
                normalizedExternal.includes(`node_modules/${pkg}/`)
            )
          ) {
            errors.push(`${name}: eager external dependency ${external} in ${c.file}`);
          }
        }
        for (const module of c.modules) {
          if (
            packages.some((pkg) => module.includes(`node_modules/${pkg}/`)) ||
            (name === 'rendererStartup' &&
              deferredDialogs.some((dialog) => module.endsWith(`/components/${dialog}`)))
          ) {
            errors.push(`${name}: eager dependency ${module} in ${c.file}`);
          }
        }
      }
      return [
        name,
        {
          bytes,
          gzip,
          budget,
          chunks: chunks.map((c) => c.file),
          externalImports: [...new Set(chunks.flatMap((c) => c.externalImports ?? []))],
        },
      ];
    })
  );
  return {
    errors,
    metrics,
    chunks: [...main.values(), ...renderer.values()].map(({ file, bytes, gzip }) => ({
      file,
      bytes,
      gzip,
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const directory = path.resolve(
      process.argv[2] ?? fileURLToPath(new URL('../dist', import.meta.url))
    );
    const result = await checkBundleBudget(directory);
    await writeFile(
      path.join(directory, 'bundle-budget-report.json'),
      `${JSON.stringify(result, null, 2)}\n`
    );
    for (const [name, metric] of Object.entries(result.metrics)) {
      console.log(
        `${name}: ${(metric.bytes / 1000).toFixed(1)} KB / ${(metric.budget / 1000).toFixed(1)} KB`
      );
    }
    if (result.errors.length) {
      console.error(result.errors.join('\n'));
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
