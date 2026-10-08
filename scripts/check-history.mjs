import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPostHistory } from '../src/lib/post-history.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path)
      : /\.(?:md|mdx|markdown)$/i.test(entry.name) ? [path] : [];
  });
}

try {
  for (const path of sources(join(root, 'src/content/blog')).sort()) {
    const history = getPostHistory(root, path);
    console.log(`${relative(root, path)}: ${history.length} committed changes`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
