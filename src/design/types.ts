/** A Figma file at one version. */
export interface DesignFile {
  readonly fileKey: string;
  readonly name: string;
  /** Changes on every save; snapshots are cached per version. */
  readonly version: string;
  readonly lastModified: string;
}

export interface Box {
  /** Position relative to the design frame the node belongs to. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Paint {
  readonly kind: 'solid' | 'image' | 'gradient' | 'other';
  /** `#rrggbb`, or `#rrggbbaa` when not opaque. Solid paints only. */
  readonly hex?: string;
}

export interface Shadow {
  readonly kind: 'drop' | 'inner';
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly spread: number;
  readonly hex: string;
}

export interface Layout {
  readonly direction: 'row' | 'column';
  readonly gap: number;
  /** Top, right, bottom, left. */
  readonly padding: readonly [number, number, number, number];
  readonly wrap: boolean;
  readonly mainAlign?: string;
  readonly crossAlign?: string;
}

export interface TextContent {
  readonly characters: string;
  readonly family?: string;
  readonly weight?: number;
  readonly sizePx?: number;
  readonly lineHeightPx?: number;
  readonly letterSpacingPx?: number;
  /** Parts of the text use other styles than the one given. */
  readonly mixed: boolean;
}

export interface ComponentUse {
  /** The component set's name (`Checkbox`), or the component's own when it has no set. */
  readonly name: string;
  /** Library key of the set or component: the stable id across files. */
  readonly key: string;
  readonly remote: boolean;
  /** Variant properties, for example `{ State: 'Default', Size: 'md' }`. */
  readonly variant: Readonly<Record<string, string>>;
  /** Boolean, text and instance-swap properties. */
  readonly properties: Readonly<Record<string, string | boolean>>;
}

/** Library styles a node uses, by their names in the library. */
export interface StyleRefs {
  readonly fill?: string;
  readonly stroke?: string;
  readonly text?: string;
  readonly effect?: string;
}

export interface DesignNode {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly box: Box;
  readonly layout?: Layout;
  readonly fills?: readonly Paint[];
  readonly strokes?: readonly Paint[];
  readonly strokeWeight?: number;
  /** One radius, or top-left, top-right, bottom-right, bottom-left. */
  readonly radius?: number | readonly [number, number, number, number];
  readonly shadows?: readonly Shadow[];
  readonly opacity?: number;
  readonly styles?: StyleRefs;
  /** Variable ids bound per property, for example `{ itemSpacing: ['VariableID:…'] }`. */
  readonly variables?: Readonly<Record<string, readonly string[]>>;
  readonly text?: TextContent;
  readonly component?: ComponentUse;
  readonly children?: readonly DesignNode[];
}

/** What a design item under the root is. */
export type ItemKind = 'frame' | 'component';

export interface FrameRef {
  readonly id: string;
  readonly name: string;
  readonly kind: ItemKind;
  /** Names of the sections it sits in, outermost first. */
  readonly sections: readonly string[];
  readonly w: number;
  readonly h: number;
}

export interface SkippedItem {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly reason: string;
  readonly sections: readonly string[];
}

export interface DesignComment {
  readonly id: string;
  readonly message: string;
  readonly resolved: boolean;
  readonly createdAt: string;
  /** The node it is pinned to, when it is pinned to one. */
  readonly nodeId?: string;
  /** The design frame holding that node, when it is in one that was read. */
  readonly frameId?: string;
  /** Id of the comment this replies to. */
  readonly parentId?: string;
}

export interface DesignSnapshot {
  readonly file: DesignFile;
  readonly root: { readonly id: string; readonly name: string; readonly type: string };
  /** Every design frame and component found under the root. */
  readonly items: readonly FrameRef[];
  readonly skipped: readonly SkippedItem[];
  /** Full node trees of the frames that were read, by frame id. */
  readonly frames: Readonly<Record<string, DesignNode>>;
  readonly hiddenNodes: number;
  readonly comments: readonly DesignComment[];
}
