// When the lineage graph draws a minimap. Kept out of the webview module for the same reason as
// nodeSize: the rule is worth testing, and the webview can't be loaded without a DOM.

import type { LineageLocation } from './lineagePlacement';

/**
 * Below this many nodes the graph fits the viewport on its own, and the minimap is a shrunken
 * copy of what is already fully visible. The initial view is one hop — typically 3 to 8 nodes —
 * so without this the minimap spends most of its life adding nothing but occupying a corner.
 */
export const MINIMAP_MIN_NODES = 10;

/**
 * The bottom panel is short and wide, and its toggles already answer "how much of the DAG": a
 * minimap there takes a corner of a graph that has little height to spare. It belongs to the
 * larger view, which is where a graph too big to take in at once is looked at.
 */
export function shouldShowMinimap(placement: LineageLocation, nodeCount: number): boolean {
  return placement === 'editor' && nodeCount >= MINIMAP_MIN_NODES;
}
