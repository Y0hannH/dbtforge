import { DbtNode } from '../index/manifestTypes';

/**
 * What a lineage node says about itself beyond its name, and how it is coloured.
 *
 * Both are read from the manifest, which means both are ultimately authored by whoever wrote the
 * dbt project — so the colour is validated here rather than handed to the webview as-is.
 */

/**
 * The row above the name: the resource type, plus the materialization when it adds something.
 *
 * A seed or a snapshot has a materialization too, but it is implied by the resource type
 * ('seed', 'snapshot'), so repeating it would just make the row longer. Models are the case that
 * matters — table vs view vs incremental vs ephemeral is exactly what the request was about.
 */
export function nodeMetaLabel(resourceType: string, materialization?: string): string {
  if (!materialization || materialization === resourceType) return resourceType;
  return `${resourceType} · ${materialization}`;
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
