export type Version = readonly [major: number, minor: number, patch: number];

/** Extracts the first `x.y.z` from tool output such as "podman version 6.1.2" or "v5.5.1". */
export function parseVersion(text: string): Version | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!match) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(left: Version, right: Version): number {
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export function formatVersion(version: Version): string {
  return version.join('.');
}
