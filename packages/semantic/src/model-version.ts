import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** What the Cube container mounts as its configuration: cube.js, its modules and the model. */
export const SEMANTIC_MODEL_DIRECTORY = fileURLToPath(new URL('../cube', import.meta.url));

/**
 * A short digest of everything Cube reads at startup (decision D3, build step 7). Cube compiles its
 * model once, in production mode, so a changed model needs a new container — and an unchanged one
 * must never be restarted, or queries in flight are cut for nothing. The value is the same for the
 * same files, whatever their order on disk or their line endings.
 */
export async function semanticModelVersion(
  directory: string = SEMANTIC_MODEL_DIRECTORY,
): Promise<string> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  const hash = createHash('sha256');
  for (const file of files) {
    const content = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
    const name = path.relative(directory, file).split(path.sep).join('/');
    hash.update(`${name}\0${content}\0`);
  }
  return hash.digest('hex').slice(0, 16);
}
