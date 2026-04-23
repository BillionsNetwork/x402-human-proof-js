import type { HumanUsageStorage } from "@0xpolygonid/x402-human-proof";

// For development and testing only. State is lost on restart and not shared
// across multiple server instances. In production, use a persistent store
// (Redis, database, etc.) by implementing the HumanUsageStorage interface.
export class InMemoryHumanUsageStorage implements HumanUsageStorage {
  private readonly counts = new Map<string, number>();

  async incrementIfBelow(humanId: string, maxUse: number, scope: string): Promise<number | null> {
    const key = `${humanId}:${scope}`;
    const current = this.counts.get(key) ?? 0;
    if (current >= maxUse) return null;
    const next = current + 1;
    this.counts.set(key, next);
    return next;
  }

  async decrementIfAboveZero(humanId: string, scope: string): Promise<number | null> {
    const key = `${humanId}:${scope}`;
    const current = this.counts.get(key) ?? 0;
    if (current <= 0) return null;
    const next = current - 1;
    if (next === 0) {
      this.counts.delete(key);
    } else {
      this.counts.set(key, next);
    }
    return next;
  }
}
