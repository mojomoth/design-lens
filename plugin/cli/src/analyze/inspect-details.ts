/// <reference lib="dom" />

import type { Rect } from './heuristics.js';
import type { ElementStyles } from './inspect.js';

/** Live measurements for one element; CSS values retain the browser's computed string format. */
export interface ElementDetails {
  visible: boolean;
  parentDlId: string | null;
  childDlIds: string[];
  /** The browser-selected image URL, before the command removes its ephemeral serving origin. */
  currentSrc: string | null;
  typography: {
    fontWeight: string;
    lineHeight: string;
    letterSpacing: string;
    textAlign: string;
    textTransform: string;
  };
  box: {
    width: string;
    height: string;
    minWidth: string;
    maxWidth: string;
    minHeight: string;
    maxHeight: string;
    boxSizing: string;
    marginTop: string;
    marginRight: string;
    marginBottom: string;
    marginLeft: string;
    paddingTop: string;
    paddingRight: string;
    paddingBottom: string;
    paddingLeft: string;
    borderTopWidth: string;
    borderRightWidth: string;
    borderBottomWidth: string;
    borderLeftWidth: string;
    borderTopStyle: string;
    borderRightStyle: string;
    borderBottomStyle: string;
    borderLeftStyle: string;
    borderTopColor: string;
    borderRightColor: string;
    borderBottomColor: string;
    borderLeftColor: string;
    borderTopLeftRadius: string;
    borderTopRightRadius: string;
    borderBottomRightRadius: string;
    borderBottomLeftRadius: string;
    boxShadow: string;
  };
  layout: {
    display: string;
    position: string;
    top: string;
    right: string;
    bottom: string;
    left: string;
    rowGap: string;
    columnGap: string;
    gridTemplateColumns: string;
    gridTemplateRows: string;
    flexDirection: string;
    flexWrap: string;
    alignItems: string;
    justifyContent: string;
    overflowX: string;
    overflowY: string;
  };
}

/** The detail probe is ephemeral; only the CLI owns projection and stdout serialization. */
export interface DetailsProbe {
  elements: Array<{ dlId: string; rect: Rect; styles: ElementStyles; details: ElementDetails }>;
  page: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    rootFontSize: string;
    body: {
      rect: Rect;
      styles: ElementStyles;
      details: ElementDetails;
    };
  };
}

/**
 * Runs inside Chromium via page.evaluate. All runtime helpers stay inside this function so
 * bundling cannot leave a reference to module scope in the browser's serialized callback.
 *
 * Lookup visits light DOM once; layout is read only for requested IDs and body. Shadow roots
 * are deliberately excluded because ordinary data-dl-id selectors cannot cross that boundary.
 */
export function probeDetails(ids: readonly string[]): DetailsProbe {
  const body = document.body;
  if (!body) throw new Error('cannot inspect details: document has no body');

  const requestedIds = [...new Set(ids)];
  const requested = new Set(requestedIds);
  const lookup = new Map<string, Element[]>();
  for (const element of Array.from(body.querySelectorAll('[data-dl-id]'))) {
    const dlId = element.getAttribute('data-dl-id');
    if (dlId === null || !requested.has(dlId)) continue;
    const matches = lookup.get(dlId);
    if (matches) matches.push(element);
    else lookup.set(dlId, [element]);
  }

  // Resolve every target before measuring; an ambiguous ID must never choose an arbitrary node.
  const targets = requestedIds.map((dlId) => {
    const matches = lookup.get(dlId);
    if (!matches || matches.length === 0) {
      throw new Error(`no light-DOM element found with data-dl-id "${dlId}"`);
    }
    if (matches.length > 1) {
      throw new Error(`multiple light-DOM elements found with data-dl-id "${dlId}"`);
    }
    return { dlId, element: matches[0] };
  });

  function measure(element: Element): {
    rect: Rect;
    styles: ElementStyles;
    details: ElementDetails;
  } {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const rect: Rect = {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
    const childDlIds: string[] = [];
    for (const child of Array.from(element.children)) {
      const dlId = child.getAttribute('data-dl-id');
      if (dlId !== null) childDlIds.push(dlId);
    }

    return {
      rect,
      styles: {
        color: style.color,
        background: style.backgroundColor,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
      },
      details: {
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
        parentDlId: element.parentElement?.getAttribute('data-dl-id') ?? null,
        childDlIds,
        currentSrc: element instanceof HTMLImageElement ? element.currentSrc || null : null,
        typography: {
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          textAlign: style.textAlign,
          textTransform: style.textTransform,
        },
        box: {
          width: style.width,
          height: style.height,
          minWidth: style.minWidth,
          maxWidth: style.maxWidth,
          minHeight: style.minHeight,
          maxHeight: style.maxHeight,
          boxSizing: style.boxSizing,
          marginTop: style.marginTop,
          marginRight: style.marginRight,
          marginBottom: style.marginBottom,
          marginLeft: style.marginLeft,
          paddingTop: style.paddingTop,
          paddingRight: style.paddingRight,
          paddingBottom: style.paddingBottom,
          paddingLeft: style.paddingLeft,
          borderTopWidth: style.borderTopWidth,
          borderRightWidth: style.borderRightWidth,
          borderBottomWidth: style.borderBottomWidth,
          borderLeftWidth: style.borderLeftWidth,
          borderTopStyle: style.borderTopStyle,
          borderRightStyle: style.borderRightStyle,
          borderBottomStyle: style.borderBottomStyle,
          borderLeftStyle: style.borderLeftStyle,
          borderTopColor: style.borderTopColor,
          borderRightColor: style.borderRightColor,
          borderBottomColor: style.borderBottomColor,
          borderLeftColor: style.borderLeftColor,
          borderTopLeftRadius: style.borderTopLeftRadius,
          borderTopRightRadius: style.borderTopRightRadius,
          borderBottomRightRadius: style.borderBottomRightRadius,
          borderBottomLeftRadius: style.borderBottomLeftRadius,
          boxShadow: style.boxShadow,
        },
        layout: {
          display: style.display,
          position: style.position,
          top: style.top,
          right: style.right,
          bottom: style.bottom,
          left: style.left,
          rowGap: style.rowGap,
          columnGap: style.columnGap,
          gridTemplateColumns: style.gridTemplateColumns,
          gridTemplateRows: style.gridTemplateRows,
          flexDirection: style.flexDirection,
          flexWrap: style.flexWrap,
          alignItems: style.alignItems,
          justifyContent: style.justifyContent,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
        },
      },
    };
  }

  return {
    elements: targets.map(({ dlId, element }) => ({ dlId, ...measure(element) })),
    page: {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      deviceScaleFactor: window.devicePixelRatio,
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      body: measure(body),
    },
  };
}
