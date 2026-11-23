import { relative } from "node:path";
import type { ResolvedConfig } from "../types.ts";
import { logWarn } from "../utils/logger.ts";
import type { CssDependencyGraph } from "./css-graph.ts";
import { attachSiblingScopedCss, findSingleRootElement } from "./scoped-css.ts";
import type { VirtualFileSystem } from "./vfs.ts";

/**
 * Attaches a co-located sibling `.css` file as `<style scoped>` to an HTML/SVG template
 * that has a single root element, emitting a warning when multiple roots exist.
 */
export async function attachSiblingCssIfPresent(options: {
  templateHtml: string;
  templatePath: string;
  siblingCssPath: string;
  kindLabel: "Page" | "Component" | "SVG";
  config: ResolvedConfig;
  vfs: VirtualFileSystem;
  cssGraph: CssDependencyGraph;
}): Promise<string> {
  const { templateHtml, templatePath, siblingCssPath, kindLabel, config, vfs, cssGraph } = options;

  if (!vfs.hasFile(siblingCssPath)) {
    return templateHtml;
  }

  let siblingCss = "";
  try {
    siblingCss = await cssGraph.flattenCss(siblingCssPath, vfs);
  } catch {
    siblingCss = await Bun.file(siblingCssPath).text();
  }

  if (siblingCss.trim().length === 0) {
    return templateHtml;
  }

  const withScopedCss = attachSiblingScopedCss(templateHtml, siblingCss);
  if (withScopedCss !== null) {
    return withScopedCss;
  }

  const relTarget = relative(config.root, templatePath);
  const relCss = relative(config.root, siblingCssPath);
  logWarn(
    `${kindLabel} "${relTarget}" has a sibling CSS file ("${relCss}"), but does not have a single root element. Scoped styles were not applied.`
  );
  return templateHtml;
}

/**
 * Merges passthrough HTML attributes (class, width, height, aria-*, etc.)
 * onto the root `<svg>` element of an inline SVG component.
 */
export function mergeSvgAttributes(svgHtml: string, props: Record<string, string>): string {
  const root = findSingleRootElement(svgHtml);
  if (!root) return svgHtml;

  let openTag = root.openTagRaw;

  for (const [key, val] of Object.entries(props)) {
    if (key === "class") {
      const classMatch = openTag.match(/\bclass=(["'])(.*?)\1/i);
      if (classMatch) {
        const quote = classMatch[1];
        const existingClasses = classMatch[2].trim();
        const combined = Array.from(
          new Set([...existingClasses.split(/\s+/), ...val.split(/\s+/)])
        )
          .filter(Boolean)
          .join(" ");
        openTag = openTag.replace(classMatch[0], () => `class=${quote}${combined}${quote}`);
      } else if (openTag.endsWith("/>")) {
        openTag = openTag.slice(0, -2).trimEnd() + ` class="${val}"/>`;
      } else {
        openTag = openTag.slice(0, -1).trimEnd() + ` class="${val}">`;
      }
    } else {
      const escapedKey = key.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const attrRegex = new RegExp(`\\b${escapedKey}(?:=(?:["'][^"']*["']|[^\\s>]+))?`, "i");
      const replacement = val === "true" ? `${key}="true"` : `${key}="${val}"`;
      if (attrRegex.test(openTag)) {
        openTag = openTag.replace(attrRegex, () => replacement);
      } else if (openTag.endsWith("/>")) {
        openTag = openTag.slice(0, -2).trimEnd() + ` ${replacement}/>`;
      } else {
        openTag = openTag.slice(0, -1).trimEnd() + ` ${replacement}>`;
      }
    }
  }

  return svgHtml.slice(0, root.openTagStart) + openTag + svgHtml.slice(root.openTagEnd);
}

/**
 * Loads an inline SVG component, strips XML/DOCTYPE prologues, attaches sibling `.css`
 * if present, and merges passthrough attributes.
 */
export async function renderSvgComponent(options: {
  compPath: string;
  props: Record<string, string>;
  config: ResolvedConfig;
  vfs: VirtualFileSystem;
  cssGraph: CssDependencyGraph;
}): Promise<string> {
  const { compPath, props, config, vfs, cssGraph } = options;

  let svgContent = await vfs.readText(compPath);
  svgContent = svgContent
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .trim();

  const siblingCssPath = compPath.replace(/\.svg$/i, ".css");
  svgContent = await attachSiblingCssIfPresent({
    templateHtml: svgContent,
    templatePath: compPath,
    siblingCssPath,
    kindLabel: "SVG",
    config,
    vfs,
    cssGraph,
  });

  const passedProps = { ...props };
  delete passedProps.src;

  return mergeSvgAttributes(svgContent, passedProps);
}
