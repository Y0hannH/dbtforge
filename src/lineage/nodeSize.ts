// Sizing for a lineage node box. Kept out of the webview module so the layout maths can be
// tested without a DOM, and — the point of the whole file — so dagre and the rendered box are
// driven by one number instead of two that can disagree.

export const NODE_HEIGHT = 44;

/** Floor: short names still get a box wide enough to read the resource-type row above them. */
export const MIN_NODE_WIDTH = 170;

/**
 * Ceiling: dbt names can run past 50 characters (`stg_salesforce__opportunity_line_items`), and a
 * box that wide pushes the rest of the graph off-screen. Past this the name ellipsizes and the
 * full text lives in the node's tooltip.
 */
export const MAX_NODE_WIDTH = 340;

// 10px of padding plus a 1px border on each side. The box is sized border-box, so this has to be
// carried by the width we hand to dagre — otherwise the rendered box is 22px wider than the slot
// reserved for it.
const HORIZONTAL_CHROME = 22;

// Average advance width of a lowercase snake_case character at 12px/600 in a UI sans (Segoe UI,
// SF, Ubuntu). Deliberately generous: over-estimating costs a few pixels of padding, whereas
// under-estimating truncates a name that would have fit.
const NAME_CHAR_WIDTH = 7.2;

/**
 * Width of the box for a node named `name`, in pixels.
 *
 * The resource-type row ("MODEL", "SNAPSHOT") is not part of the calculation: at 10px uppercase
 * the longest of them is still well under MIN_NODE_WIDTH, so the name always decides.
 */
export function lineageNodeWidth(name: string): number {
  const contentWidth = name.length * NAME_CHAR_WIDTH + HORIZONTAL_CHROME;
  return Math.round(Math.min(Math.max(contentWidth, MIN_NODE_WIDTH), MAX_NODE_WIDTH));
}
