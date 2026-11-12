import type { FigmaNode, FigmaNodeEntry } from '../src/design/figma-json.ts';

/** Made-up Figma REST nodes for tests; no real design data. */
export function node(type: string, id: string, name: string, extra: Partial<FigmaNode> = {}, box: [number, number, number, number] = [0, 0, 100, 100]): FigmaNode {
  const [x, y, width, height] = box;
  return { id, name, type, absoluteBoundingBox: { x, y, width, height }, ...extra };
}

export const solid = (r: number, g: number, b: number, a = 1, extra: object = {}) => ({ type: 'SOLID', color: { r, g, b, a }, ...extra });

export function entry(document: FigmaNode, extra: Partial<FigmaNodeEntry> = {}): FigmaNodeEntry {
  return { document, components: {}, componentSets: {}, styles: {}, ...extra };
}

/** A page with two sections: screens with the usual clutter beside them, and local components. */
export function samplePage(): FigmaNode {
  return node('CANVAS', '0:1', 'Checkout', {
    children: [
      node('SECTION', '1:1', 'Final', {
        children: [
          node('FRAME', '2:1', 'Cart page', { children: [node('TEXT', '3:1', 'Title')] }, [0, 0, 1280, 900]),
          node('FRAME', '2:2', 'Cart page empty', {}, [1400, 0, 1280.4, 899.6]),
          node('RECTANGLE', '2:3', 'Screenshot 2026-01-01', { fills: [{ type: 'IMAGE' }] }),
          node('VECTOR', '2:4', 'Arrow 1'),
          node('LINE', '2:5', 'Line 1'),
          node('RECTANGLE', '2:6', 'Rectangle 1', { fills: [], strokes: [solid(1, 0, 0)] }),
          node('RECTANGLE', '2:7', 'Card background', { fills: [solid(1, 1, 1)] }),
          node('FRAME', '2:8', 'Frame 1', { children: [node('TEXT', '3:2', 'STEP ONE')] }, [0, 0, 300, 56]),
          node('FRAME', '2:9', 'Tall text frame', { children: [node('TEXT', '3:3', 'Body')] }, [0, 0, 300, 400]),
          node('TEXT', '2:10', 'Designer note'),
          node('FRAME', '2:11', 'Old version', { visible: false }),
          node('SECTION', '1:2', 'Icons', {
            children: [
              node('FRAME', '2:12', 'icon-cart', { children: [node('VECTOR', '3:4', 'path')] }, [0, 0, 24, 24]),
              node('SECTION', '1:4', 'Old icons', {
                children: [
                  node('FRAME', '2:15', 'icon-old', { children: [node('VECTOR', '3:5', 'path')] }, [0, 0, 24, 24]),
                  node('FRAME', '2:16', 'Frame 2', { children: [node('TEXT', '3:6', 'OLD')] }, [0, 0, 120, 40]),
                ],
              }),
            ],
          }),
        ],
      }),
      node('SECTION', '1:3', 'Components', {
        children: [node('COMPONENT', '2:13', 'Cart-row'), node('COMPONENT_SET', '2:14', 'Pill')],
      }),
    ],
  });
}

/** The tree cut at `depth` levels below `n`, the way Figma's `depth` parameter returns it: children beyond it come back empty. */
export function cutAt(n: FigmaNode, depth: number): FigmaNode {
  if (!n.children) return n;
  return { ...n, children: depth === 0 ? [] : n.children.map((c) => cutAt(c, depth - 1)) };
}
