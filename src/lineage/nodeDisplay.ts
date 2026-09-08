import { DbtNode } from '../index/manifestTypes';

/**
 * What a lineage node says about itself beyond its name, and how it is coloured.
 *
 * The label is assembled from the manifest and — for the column count alone — the catalog; the
 * colour comes from the manifest too. All of it is ultimately authored by whoever wrote the dbt
 * project, so the colour is validated here rather than handed to the webview as-is.
 */

/** What the row above the name can carry, beyond the resource type itself. */
export interface NodeMetaFacts {
  materialization?: string;
  /** `config.target_lag`, verbatim — a duration or the word 'downstream'. */
  targetLag?: string;
  /** How many columns the warehouse reports, or undefined when the catalog cannot say. */
  columnCount?: number;
}

/**
 * The row above the name: the resource type, plus whatever else is known about the node.
 *
 * A seed or a snapshot has a materialization too, but it is implied by the resource type
 * ('seed', 'snapshot'), so repeating it would just make the row longer. Models are the case that
 * matters — table vs view vs incremental vs ephemeral is exactly what the request was about.
 *
 * Everything here is optional and silently absent, which is the point: a project with no dynamic
 * tables and no generated catalog sees exactly the row it saw before any of this was read.
 */
export function nodeMetaLabel(resourceType: string, facts: NodeMetaFacts = {}): string {
  const { materialization, targetLag, columnCount } = facts;
  let label = resourceType;

  if (materialization && materialization !== resourceType) {
    label = `${resourceType} · ${materialization}`;
    // Parenthesised rather than given its own ` · ` segment: the lag is a property of the
    // materialization, not a third fact about the node, and the row reads wrong if it looks like
    // one. Only appended alongside a materialization, since it describes it.
    if (targetLag?.trim()) label += ` (${targetLag.trim()})`;
  }

  // A count of zero is treated as no answer rather than shown: catalog.json only describes
  // relations that exist in the warehouse, and one of those never has zero columns — so a zero
  // here is a malformed entry, and 'model · 0 cols' would state something false about the model.
  if (columnCount !== undefined && columnCount > 0) {
    label += ` · ${columnCount} ${columnCount === 1 ? 'col' : 'cols'}`;
  }

  return label;
}

/** `node_color` as declared on the node, from either place dbt can put it. */
export function readNodeColor(node: DbtNode): string | undefined {
  return sanitizeNodeColor(node.docs?.node_color ?? node.config?.docs?.node_color);
}

// dbt documents node_color as "a hex code or a CSS colour name" but does not enforce it, so the
// value reaching us is arbitrary text from a project file. It ends up in a style property in the
// webview: browsers drop values they cannot parse, but a value that parses as something *else*
// entirely is the part worth refusing here, at the boundary, rather than trusting the renderer.
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const CSS_COLOR_NAME = /^[a-z]{3,20}$/i;

/**
 * The colour to paint the node with, or undefined when the declared value isn't one we're
 * prepared to hand to the renderer. Undefined is a fine outcome — the node keeps its default
 * border, exactly as before node_color was read at all.
 */
export function sanitizeNodeColor(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (HEX_COLOR.test(value)) return value.toLowerCase();
  // A bare word can only be a CSS colour keyword; if it isn't one, the browser ignores it and the
  // node falls back to its default border, which is the same outcome as rejecting it here.
  if (CSS_COLOR_NAME.test(value)) return value.toLowerCase();
  return undefined;
}
