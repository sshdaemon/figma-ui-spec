/** The parts of Figma's REST responses this tool reads. Everything is optional because Figma omits defaults. */

export interface FigmaColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface FigmaPaint {
  readonly type: string;
  readonly visible?: boolean;
  readonly opacity?: number;
  readonly color?: FigmaColor;
}

export interface FigmaEffect {
  readonly type: string;
  readonly visible?: boolean;
  readonly color?: FigmaColor;
  readonly offset?: { readonly x: number; readonly y: number };
  readonly radius?: number;
  readonly spread?: number;
}

export interface FigmaVariableAlias {
  readonly type: string;
  readonly id: string;
}

export interface FigmaNode {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly visible?: boolean;
  readonly children?: readonly FigmaNode[];
  readonly absoluteBoundingBox?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
  readonly fills?: readonly FigmaPaint[];
  readonly strokes?: readonly FigmaPaint[];
  readonly strokeWeight?: number;
  readonly cornerRadius?: number | null;
  readonly rectangleCornerRadii?: readonly number[] | null;
  readonly effects?: readonly FigmaEffect[];
  readonly opacity?: number;
  readonly layoutMode?: string | null;
  readonly layoutWrap?: string;
  readonly itemSpacing?: number | null;
  readonly paddingTop?: number | null;
  readonly paddingRight?: number | null;
  readonly paddingBottom?: number | null;
  readonly paddingLeft?: number | null;
  readonly primaryAxisAlignItems?: string | null;
  readonly counterAxisAlignItems?: string | null;
  readonly styles?: Readonly<Record<string, string>>;
  readonly boundVariables?: Readonly<Record<string, unknown>>;
  readonly characters?: string;
  readonly style?: {
    readonly fontFamily?: string;
    readonly fontWeight?: number;
    readonly fontSize?: number;
    readonly lineHeightPx?: number;
    readonly letterSpacing?: number;
  };
  readonly characterStyleOverrides?: readonly number[];
  readonly componentId?: string;
  readonly componentProperties?: Readonly<Record<string, { readonly type: string; readonly value: string | boolean }>>;
}

export interface FigmaComponentMeta {
  readonly key: string;
  readonly name: string;
  readonly remote?: boolean;
  readonly componentSetId?: string;
}

export interface FigmaStyleMeta {
  readonly key: string;
  readonly name: string;
  readonly styleType: string;
  readonly remote?: boolean;
}

/** One entry of `GET /v1/files/:key/nodes`. */
export interface FigmaNodeEntry {
  readonly document: FigmaNode;
  readonly components?: Readonly<Record<string, FigmaComponentMeta>>;
  readonly componentSets?: Readonly<Record<string, FigmaComponentMeta>>;
  readonly styles?: Readonly<Record<string, FigmaStyleMeta>>;
}

export interface FigmaNodesResponse {
  readonly name: string;
  readonly version: string;
  readonly lastModified: string;
  readonly nodes: Readonly<Record<string, FigmaNodeEntry | null>>;
}

export interface FigmaFileMeta {
  readonly name: string;
  readonly version: string;
  readonly lastModified: string;
}

export interface FigmaComment {
  readonly id: string;
  readonly message: string;
  readonly created_at: string;
  readonly resolved_at?: string | null;
  readonly parent_id?: string;
  readonly client_meta?: { readonly node_id?: string } | null;
}
