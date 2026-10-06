/**
 * Capture disclosures: facts a reader must know about how the static source state was produced,
 * which do NOT make the evidence incomplete. `complete` still means "no warnings"; every disclosure
 * is repeated in REPORT.md (`Disclosed:` / `Substituted (not remote):` lines) and in fidelity.json.
 */

export const DISCLOSURE_CODES = [
  'media-substituted', 'lazy-promoted', 'hidden-images-unloaded', 'timers-frozen', 'smil-paused',
  'marquee-stopped', 'body-unread-nondesign', 'body-unread-reconciled', 'late-stamped',
  'readiness-retried', 'readiness-budget-exhausted',
] as const;
export type DisclosureCode = typeof DISCLOSURE_CODES[number];

export interface CaptureDisclosure {
  code: DisclosureCode;
  detail: string;
  /** Capture-local `data-dl-id`s the disclosure is about, when it is element-scoped. */
  dlIds?: string[];
}

/** One 2xx response whose body Chromium would not hand back (redirect bodies, beacons, aborts). */
export interface BodyReadFailure {
  url: string;
  resourceType: string;
  status: number;
}

/** Resource types whose bytes can appear in the clone; everything else is never written to it. */
const DESIGN_RESOURCE_TYPES = new Set(['document', 'stylesheet', 'image', 'media', 'font', 'texttrack']);

/** Endpoints named in the non-design body disclosure; the rest are counted. */
const NONDESIGN_LISTED = 12;

/**
 * A body-read failure only threatens the clone when the bytes are absent AND the resource could be
 * part of the clone. Bytes stored from another response (or the refetch) are not lost; analytics
 * beacons, scripts and XHR never reach the inert clone.
 */
export function reconcileBodyReads(
  failures: readonly BodyReadFailure[], stored: (url: string) => boolean,
): { warnings: string[]; disclosures: CaptureDisclosure[] } {
  const warnings: string[] = [];
  const reconciled = new Set<string>();
  const nondesign = new Set<string>();
  for (const failure of failures) {
    if (stored(failure.url)) reconciled.add(failure.url);
    else if (!DESIGN_RESOURCE_TYPES.has(failure.resourceType)) nondesign.add(`${failure.resourceType} ${failure.url}`);
    else warnings.push(`could not read response body: ${failure.url}`);
  }
  const disclosures: CaptureDisclosure[] = [];
  if (reconciled.size > 0) {
    disclosures.push({ code: 'body-unread-reconciled', detail: `${counted(reconciled.size, 'unreadable response body was', 'unreadable response bodies were')} stored from another response: ${[...reconciled].sort().join(', ')}` });
  }
  if (nondesign.size > 0) {
    // Analytics beacons carry kilobyte query strings; the disclosure names each endpoint once, without them.
    const endpoints = [...new Set([...nondesign].map((entry) => entry.replace(/[?#].*$/, '')))].sort();
    const listed = endpoints.length > NONDESIGN_LISTED ? [...endpoints.slice(0, NONDESIGN_LISTED), `and ${endpoints.length - NONDESIGN_LISTED} more`] : endpoints;
    disclosures.push({ code: 'body-unread-nondesign', detail: `${counted(nondesign.size, 'unreadable non-design response body', 'unreadable non-design response bodies')} (never part of the clone): ${listed.join(', ')}` });
  }
  return { warnings: [...new Set(warnings)], disclosures };
}

/** `1 image was` / `2 images were`: disclosure details are read by people in REPORT.md. */
export function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** One human line per disclosure, shared by REPORT.md and fidelity.json. */
export function disclosureLine(disclosure: CaptureDisclosure): string {
  return `${disclosure.code}: ${disclosure.detail.replace(/\s+/g, ' ').trim()}`;
}
