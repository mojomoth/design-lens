import { collapseText, relativizeUrl } from './heuristics.js';
import type { ElementDetails } from './inspect-details.js';
import type { InspectElement, UnclassifiedInspectElement } from './inspect.js';
import type { ElementObservation } from './observations.js';

export interface ComprehensiveDetails extends ElementDetails {
  semantic: string;
  domPath: string;
  rootPath: string[];
  pseudo: ElementObservation['pseudo'];
  image: ElementObservation['image'] | null;
  visual: Record<string, string>;
}

/** All grouped values come from one observation, without a second browser measurement. */
export function detailsFromObservation(element: ElementObservation, origin: string): ComprehensiveDetails {
  function pick<T extends string>(keys: readonly T[]): Record<T, string> {
    return Object.fromEntries(keys.map((key) => [key, (element.styles[key] ?? '').split(origin).join('')])) as Record<T, string>;
  }
  const pseudo = (value: ElementObservation['pseudo']['before']): ElementObservation['pseudo']['before'] => ({
    content: value.content,
    styles: Object.fromEntries(Object.entries(value.styles).map(([key, item]) => [key, item.split(origin).join('')])),
  });
  return {
    visible: element.visible, parentDlId: element.parentDlId, childDlIds: element.childDlIds,
    currentSrc: element.currentSrc === null ? null : relativizeUrl(element.currentSrc, origin),
    typography: pick(['fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'textTransform']),
    box: pick([
      'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'boxSizing',
      'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
      'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
      'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius', 'boxShadow',
    ]),
    layout: pick([
      'display', 'position', 'top', 'right', 'bottom', 'left', 'rowGap', 'columnGap',
      'gridTemplateColumns', 'gridTemplateRows', 'flexDirection', 'flexWrap', 'alignItems',
      'justifyContent', 'overflowX', 'overflowY',
    ]),
    semantic: element.semantic, domPath: element.domPath, rootPath: element.rootPath,
    pseudo: { before: pseudo(element.pseudo.before), after: pseudo(element.pseudo.after) },
    image: element.image ?? null,
    visual: pick([
      'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
      'objectFit', 'objectPosition', 'opacity', 'visibility', 'transform', 'transformOrigin',
      'filter', 'backdropFilter', 'mixBlendMode', 'clipPath', 'aspectRatio',
    ]),
  };
}

/** Existing classified roles retain their confidence; broad semantic labels remain observations. */
export function inventoryFromObservation(
  element: ElementObservation, origin: string, classified?: InspectElement,
): InspectElement | UnclassifiedInspectElement {
  return {
    dlId: element.dlId,
    role: classified?.role ?? null,
    confidence: classified?.confidence ?? null,
    tag: element.tag,
    selector: `[data-dl-id="${element.dlId}"]`,
    text: collapseText(element.text),
    src: element.src === undefined || element.src === null ? null : relativizeUrl(element.src, origin),
    rect: element.rect,
    styles: {
      color: element.styles.color ?? '', background: element.styles.backgroundColor ?? '',
      fontSize: element.styles.fontSize ?? '', fontFamily: element.styles.fontFamily ?? '',
    },
  } as InspectElement | UnclassifiedInspectElement;
}
