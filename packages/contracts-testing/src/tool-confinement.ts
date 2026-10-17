import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * A tool the platform uses behind a port, and the one package allowed to name it (docs/21 §2.4):
 * replacing the tool then touches that package alone. The owning package declares its own
 * confinement and runs it with `describeToolConfinement`.
 */
export interface ToolConfinement {
  /** The tool's name, for the test's title. */
  tool: string;
  /** What counts as naming the tool, matched against the text of every file. */
  pattern: RegExp;
  /** The owning package, as a repository path: `packages/ingestion`. */
  ownerPackage: string;
  /**
   * Files outside the owner that name the tool on purpose, each with its reason — guards that
   * exist to stop the tool, and their tests. The list is exact: a file that stops naming the tool
   * leaves it too.
   */
  knownExceptions: Readonly<Record<string, string>>;
}

export interface ToolMentionSearch {
  pattern: RegExp;
  ownerPackage: string;
  /** Defaults to the repository the current directory belongs to. */
  repositoryRoot?: string;
}

/**
 * Every file outside the owning package that names the tool, sorted. Files are what Git tracks or
 * would track: what it ignores (dependencies, environments, data, caches) is not the platform's
 * code. Markdown is left out: documentation is where the choice of a tool is explained.
 */
export function findToolMentions(search: ToolMentionSearch): string[] {
  const root = search.repositoryRoot ?? repositoryRootOf(process.cwd());
  const owner = `${search.ownerPackage.replace(/\/+$/, '')}/`;
  // A global or sticky pattern keeps state between calls to test(): matching must not depend on
  // the file before.
  const pattern = new RegExp(search.pattern.source, search.pattern.flags.replace(/[gy]/g, ''));

  return repositoryFiles(root)
    .filter((file) => !file.startsWith(owner) && !file.endsWith('.md'))
    .filter((file) => {
      try {
        return pattern.test(readFileSync(path.join(root, file), 'utf8'));
      } catch {
        // Listed but gone from the working tree (deleted, not yet committed).
        return false;
      }
    })
    .sort();
}

/** The battery a package runs to keep its tool to itself (docs/21 §2.4). */
export function describeToolConfinement(confinement: ToolConfinement): void {
  describe(`${confinement.tool} stays inside ${confinement.ownerPackage}`, () => {
    it('is named by no other file but its known exceptions', () => {
      const mentions = findToolMentions(confinement);

      expect(mentions).toEqual(Object.keys(confinement.knownExceptions).sort());
    });
  });
}

function repositoryRootOf(directory: string): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: directory,
    encoding: 'utf8',
  }).trim();
}

/** Tracked and untracked files, without what Git ignores. */
function repositoryFiles(root: string): string[] {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
}
