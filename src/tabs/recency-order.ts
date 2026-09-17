export class RecencyOrder<K> {
  // Set iteration order is insertion order, so the first key is the least recent.
  private readonly keys = new Set<K>();

  get size(): number {
    return this.keys.size;
  }

  touch(key: K): void {
    this.keys.delete(key);
    this.keys.add(key);
  }

  delete(key: K): void {
    this.keys.delete(key);
  }

  clear(): void {
    this.keys.clear();
  }

  evictionCandidates(limit: number, protectedKey: K): K[] {
    if (limit <= 0) return [];
    const surplus = this.keys.size - limit;
    const candidates: K[] = [];
    for (const key of this.keys) {
      if (candidates.length >= surplus) break;
      if (key !== protectedKey) candidates.push(key);
    }
    return candidates;
  }
}
