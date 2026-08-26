type VersionTuple = readonly [number, number, number];

function versionTuple(version: string): VersionTuple {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match === null) {
    throw new Error(`Expected a numeric semantic version, received ${version}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function maxVersion(a: string, b: string): string {
  const left = versionTuple(a);
  const right = versionTuple(b);
  for (let index = 0; index < left.length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference > 0 ? a : b;
    }
  }
  return a;
}
