import type { Conflict, ConflictKind, Outcome } from './types.ts';

interface Draft {
  id: string;
  key: string;
  kind: ConflictKind;
  design: string;
  nearest: string;
  override?: string;
  note?: string;
  uses: number;
  examples: string[];
  outcome: Outcome;
  decidedBy?: string;
  decided?: string;
}

export interface ConflictInput {
  readonly kind: ConflictKind;
  /** Distinct per design value: the same value used in many places is one conflict. */
  readonly key: string;
  readonly design: string;
  readonly nearest: string;
  readonly override?: string;
  readonly note?: string;
}

const EXAMPLES = 3;

/** Collects conflicts as the tree is built. Ids and decisions carry over from an earlier spec by key, so re-running keeps them. */
export class ConflictRegistry {
  private readonly byKey = new Map<string, Draft>();
  private readonly previous: ReadonlyMap<string, Conflict>;
  private next: number;

  constructor(previous: readonly Conflict[] = []) {
    this.previous = new Map(previous.map((c) => [c.key, c]));
    this.next = Math.max(0, ...previous.map((c) => Number(c.id.slice(1)) || 0)) + 1;
  }

  add(input: ConflictInput, nodeId: string): string {
    const existing = this.byKey.get(input.key);
    if (existing) {
      existing.uses++;
      if (existing.examples.length < EXAMPLES) existing.examples.push(nodeId);
      return existing.id;
    }
    const before = this.previous.get(input.key);
    const draft: Draft = {
      ...input,
      id: before?.id ?? `K${this.next++}`,
      uses: 1,
      examples: [nodeId],
      outcome: before?.outcome ?? 'nearest',
      ...(before?.decidedBy ? { decidedBy: before.decidedBy } : {}),
      ...(before?.decided ? { decided: before.decided } : {}),
    };
    this.byKey.set(input.key, draft);
    return draft.id;
  }

  /** This run's conflicts, plus earlier ones it did not meet (`uses: 0`), so their ids and decisions survive a partial run. */
  list(): Conflict[] {
    const unmet = [...this.previous.values()].filter((c) => !this.byKey.has(c.key)).map((c) => ({ ...c, uses: 0, examples: [] }));
    return [...this.byKey.values(), ...unmet].toSorted((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  }
}
