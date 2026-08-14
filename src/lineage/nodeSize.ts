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

// The meta row above the name is 10px, uppercased — narrower per character than the name, but
// wider per letter than lowercase, and long enough to decide the box on its own once the
// materialization joins the resource type ("SNAPSHOT · MATERIALIZED_VIEW").
const META_CHAR_WIDTH = 6.6;

/**
 * Width of the box for a lineage node, in pixels.
 *
 * Both rows are measured because either can be the longest: a short name under a long
 * type-and-materialization label would otherwise be sized off the wrong one.
 */
export function lineageNodeWidth(name: string, metaLabel = ''): number {
  const contentWidth =
    Math.max(name.length * NAME_CHAR_WIDTH, metaLabel.length * META_CHAR_WIDTH) + HORIZONTAL_CHROME;
  return Math.round(Math.min(Math.max(contentWidth, MIN_NODE_WIDTH), MAX_NODE_WIDTH));
}
