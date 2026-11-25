import type { ComponentRow } from '../mapping/components.ts';

/** What to do about a design value the code does not have. `nearest` applies unless someone decides otherwise. */
export type Outcome = 'nearest' | 'local-override' | 'new-variant' | 'token-change';

export const OUTCOMES: readonly Outcome[] = ['nearest', 'local-override', 'new-variant', 'token-change'];

export type ConflictKind = 'colour' | 'text' | 'shadow' | 'spacing' | 'radius';

export interface Conflict {
  /** `K1`, `K2`…, stable across re-runs for the same `key`. */
  readonly id: string;
  /** What makes two conflicts the same one, for example `spacing:7`. */
  readonly key: string;
  readonly kind: ConflictKind;
  /** The design's value, for example `padding 7px` or `Lexend 20/30 700`. */
  readonly design: string;
  /** What the `nearest` outcome builds. */
  readonly nearest: string;
  /** What a `local-override` would write instead, when there is an exact one. */
  readonly override?: string;
  readonly note?: string;
  readonly uses: number;
  readonly examples: readonly string[];
  readonly outcome: Outcome;
  readonly decidedBy?: string;
  readonly decided?: string;
}

export type NodeKind = 'box' | 'text' | 'component' | 'icon' | 'image' | 'vector';

export interface SpecNode {
  readonly id: string;
  readonly name: string;
  readonly kind: NodeKind;
  /** A code component (`file#Export`), a typography variant (`Heading level=6`), or nothing for plain markup. */
  readonly code?: string;
  /** For a component or icon instance, the key `map` uses for it. */
  readonly componentKey?: string;
  readonly props?: Readonly<Record<string, string>>;
  readonly classes: readonly string[];
  readonly text?: string;
  /** Text inside a component instance, such as its label. */
  readonly texts?: readonly string[];
  readonly conflicts?: readonly string[];
  readonly children?: readonly SpecNode[];
}

/** The inner tree of a component no code component is mapped to, to build as new markup. */
export interface ComponentDefinition {
  readonly key: string;
  readonly name: string;
  /** The variant this tree shows, as `Prop=value, …`; empty for a component without variants. */
  readonly variant: string;
  readonly tree: SpecNode;
}

/**
 * `reference` frames show today's UI for comparison; `superseded` frames belong to an earlier iteration of the design.
 * Neither is built.
 */
export type StateRole = 'design' | 'reference' | 'superseded';

export interface SpecState {
  readonly frameId: string;
  readonly name: string;
  /** The designer's label above the frame, such as `LIVE SCREEN`. */
  readonly label?: string;
  readonly role: StateRole;
  readonly size: { readonly w: number; readonly h: number };
  /** Open designer comments pinned inside the frame. */
  readonly notes: readonly string[];
  readonly tree?: SpecNode;
}

export interface SpecScreen {
  readonly name: string;
  readonly sections: readonly string[];
  readonly states: readonly SpecState[];
}

export interface UiSpec {
  readonly format: 1;
  readonly generated: string;
  readonly repo: string;
  readonly source: {
    readonly file: string;
    readonly fileKey: string;
    readonly version: string;
    readonly root: string;
    readonly rootId: string;
  };
  readonly screens: readonly SpecScreen[];
  readonly components: readonly ComponentRow[];
  /** Unmapped components' inner trees, each written once. */
  readonly definitions: readonly ComponentDefinition[];
  readonly conflicts: readonly Conflict[];
  /** Things the design leaves open: missing states, unmapped components, open comments. */
  readonly questions: readonly string[];
  /** Names and values that differ between the design and the code, for the designer. */
  readonly gaps: readonly string[];
}
