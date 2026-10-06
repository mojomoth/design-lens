/// <reference lib="dom" />
/**
 * Resource readiness before the capture freeze: fonts and images, polled in bounded windows.
 *
 * Native `loading="lazy"` images inside horizontal tracks or `display:none` menus never intersect
 * the viewport, so no amount of waiting loads them, while the serializer drops `loading` and the
 * clone loads them eagerly. The `eager` policy promotes them before waiting so source and clone
 * agree. Retries double the window but never spend the reserve kept for serialization, screenshots
 * and refetch. Hidden images are not painted: when only they stay unloaded the capture discloses it
 * (the clone refetches their bytes; a refetch failure still leaves the capture incomplete).
 *
 * In-page callbacks are passed to `page.evaluate` and must stay self-contained.
 */

import type { Frame, Page } from 'playwright';

import type { FontReadiness } from './browser.js';
import { counted, type CaptureDisclosure } from './disclosures.js';

export interface ReadinessPolicy {
  /** First window in milliseconds; retry N waits `timeoutMs * 2^N`. */
  timeoutMs: number;
  retries: number;
  lazyImages: 'eager' | 'native';
  /** Milliseconds before the deadline that retries may never use. */
  reserveMs: number;
}

/** One bounded window per phase, no lazy promotion: the behavior every legacy caller relies on. */
export const LEGACY_READINESS: ReadinessPolicy = { timeoutMs: 5_000, retries: 0, lazyImages: 'native', reserveMs: 0 };

export interface ReadinessAttempt {
  attempt: number;
  windowMs: number;
  elapsedMs: number;
  fonts: FontReadiness['status'];
  images: { total: number; pendingVisible: string[]; pendingHidden: string[]; failedVisible: string[]; failedHidden: string[] };
}

export interface ReadinessResult {
  ready: boolean;
  promotedLazy: string[];
  attempts: ReadinessAttempt[];
  fonts: FontReadiness;
  images: { total: number; pending: number; failed: number };
  warnings: string[];
  disclosures: CaptureDisclosure[];
}

interface ProbeResult {
  fonts: FontReadiness;
  images: ReadinessAttempt['images'];
}

/** Promote lazy images and frames in the document and every open shadow root; returns their IDs. */
export function promoteLazyMedia(page: Page | Frame, activeResponsiveOnly = false): Promise<string[]> {
  return page.evaluate((activeOnly: boolean): string[] => {
    const promoted: string[] = [];
    const roots: Array<Document | ShadowRoot> = [document];
    for (let index = 0; index < roots.length && index < 20_000; index += 1) {
      for (const element of Array.from(roots[index].querySelectorAll('*'))) {
        if (activeOnly && element.getAttribute('data-dl-generated') === 'host' && getComputedStyle(element).display === 'none') continue;
        if (element.shadowRoot) roots.push(element.shadowRoot);
        const tag = element.localName;
        if ((tag === 'img' || tag === 'iframe') && (element.getAttribute('loading') ?? '').trim().toLowerCase() === 'lazy') {
          // Only deferred images change; an image the sweep already loaded is not reported.
          const deferred = !(element instanceof HTMLImageElement) || !element.complete;
          element.setAttribute('loading', 'eager');
          if (deferred) promoted.push(element.getAttribute('data-dl-id') ?? `(unstamped ${tag})`);
        }
      }
    }
    return promoted;
  }, activeResponsiveOnly);
}

/** Wait up to `windowMs` per phase for fonts, then for every image, and classify what remains. */
function probe(page: Page | Frame, windowMs: number, deadline: number, activeResponsiveOnly: boolean): Promise<ProbeResult> {
  return page.evaluate(async ({ windowMs, deadline, activeResponsiveOnly }): Promise<ProbeResult> => {
    const runtime = (window as unknown as { __designLensCaptureRuntime?: { sleep?(ms: number): Promise<void> } }).__designLensCaptureRuntime;
    // Frozen page timers would never resolve an ordinary timeout; the runtime keeps a native one.
    const sleep = (ms: number): Promise<void> => runtime?.sleep
      ? runtime.sleep(Math.max(0, ms))
      : new Promise((resolve) => { window.setTimeout(resolve, Math.max(0, ms)); });
    const elements: Element[] = [];
    const stack = document.body ? [document.body as Element] : [];
    while (stack.length > 0 && elements.length < 20_000) {
      const element = stack.pop()!;
      if (activeResponsiveOnly && element.getAttribute('data-dl-generated') === 'host'
          && element.shadowRoot && getComputedStyle(element).display === 'none') continue;
      elements.push(element);
      stack.push(...Array.from(element.children));
      if (element.shadowRoot) stack.push(...Array.from(element.shadowRoot.children));
    }
    const fontBudget = Math.min(windowMs, Math.max(0, deadline - Date.now()));
    const fontStatus = document.fonts ? await Promise.race([
      document.fonts.ready.then(() => 'ready' as const),
      sleep(fontBudget).then(() => 'timeout' as const),
    ]) : 'unavailable' as const;
    const failedFamilies = new Set<string>();
    document.fonts?.forEach((face) => { if (face.status === 'error') failedFamilies.add(face.family); });

    const images = elements.filter((element): element is HTMLImageElement => element instanceof HTMLImageElement
      && Boolean(element.currentSrc || element.getAttribute('src')));
    const imageDeadline = Math.min(deadline, Date.now() + windowMs);
    while (images.some((image) => !image.complete) && Date.now() < imageDeadline) await sleep(Math.min(25, imageDeadline - Date.now()));
    // An unloaded image without width/height has a 0x0 box by construction, so the box cannot tell a
    // pending in-flow image from a hidden one: only CSS visibility or an explicit zero size can.
    const zero = (value: string | null): boolean => value !== null && /^\s*0(?:\.0*)?(?:px)?\s*$/i.test(value);
    const visible = (image: HTMLImageElement): boolean => {
      if (!image.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      const box = image.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) return true;
      const explicitZero = zero(image.getAttribute('width')) || zero(image.getAttribute('height'))
        || zero(image.style.width) || zero(image.style.height);
      return !explicitZero && (!image.complete || image.naturalWidth === 0);
    };
    const id = (image: HTMLImageElement): string => image.getAttribute('data-dl-id') ?? '(unstamped img)';
    const pending = images.filter((image) => !image.complete);
    const failed = images.filter((image) => image.complete && image.naturalWidth === 0);
    return {
      fonts: { status: fontStatus, failedFamilies: [...failedFamilies].sort() },
      images: {
        total: images.length,
        pendingVisible: pending.filter(visible).map(id),
        pendingHidden: pending.filter((image) => !visible(image)).map(id),
        failedVisible: failed.filter(visible).map(id),
        failedHidden: failed.filter((image) => !visible(image)).map(id),
      },
    };
  }, { windowMs, deadline, activeResponsiveOnly });
}

/**
 * Await readiness in up to `1 + retries` windows. Retries stop as soon as nothing visible is
 * pending and fonts did not time out; failed images never change, so they never trigger a retry.
 */
export async function awaitReadiness(
  page: Page | Frame, deadline: number, policy: ReadinessPolicy, options: { activeResponsiveOnly?: boolean } = {},
): Promise<ReadinessResult> {
  const activeOnly = options.activeResponsiveOnly === true;
  const promoted = new Set<string>();
  const attempts: ReadinessAttempt[] = [];
  const disclosures: CaptureDisclosure[] = [];
  let last: ProbeResult | undefined;
  for (let attempt = 0; attempt <= policy.retries; attempt += 1) {
    const remaining = deadline - Date.now();
    const windowMs = attempt === 0
      ? Math.max(0, Math.min(policy.timeoutMs, remaining))
      : Math.min(policy.timeoutMs * 2 ** attempt, remaining - policy.reserveMs);
    if (attempt > 0 && windowMs <= 0) {
      disclosures.push({ code: 'readiness-budget-exhausted', detail: `readiness retry ${attempt} was skipped to keep ${Math.round(policy.reserveMs)} ms for serialization and screenshots` });
      break;
    }
    // Scripts may insert new lazy images while earlier ones load.
    if (policy.lazyImages === 'eager') for (const id of await promoteLazyMedia(page, activeOnly)) promoted.add(id);
    const started = Date.now();
    last = await probe(page, windowMs, deadline, activeOnly);
    attempts.push({ attempt, windowMs, elapsedMs: Date.now() - started, fonts: last.fonts.status, images: last.images });
    // Only a font timeout or a visible pending image can change with more time; an unavailable
    // font API never does.
    if (last.fonts.status !== 'timeout' && last.images.pendingVisible.length === 0) break;
  }
  const final: ProbeResult = last ?? { fonts: { status: 'unavailable', failedFamilies: [] },
    images: { total: 0, pendingVisible: [], pendingHidden: [], failedVisible: [], failedHidden: [] } };
  const { fonts, images } = final;
  const warnings: string[] = [];
  if (fonts.status !== 'ready') warnings.push(`font readiness ${fonts.status}`);
  if (fonts.failedFamilies.length > 0) warnings.push(`failed font families: ${fonts.failedFamilies.join(', ')}`);
  if (images.pendingVisible.length > 0) warnings.push(`${images.pendingVisible.length} image loads exceeded capture readiness budget`);
  if (images.failedVisible.length > 0) warnings.push(`${images.failedVisible.length} images failed to load`);
  if (promoted.size > 0) {
    disclosures.push({ code: 'lazy-promoted', detail: `${counted(promoted.size, 'loading=lazy image or frame was', 'loading=lazy images or frames were')} loaded eagerly before readiness, as the clone loads them`, dlIds: [...promoted] });
  }
  if (attempts.length > 1) {
    disclosures.push({ code: 'readiness-retried', detail: `readiness used ${attempts.length} windows (${attempts.map((entry) => entry.windowMs).join(', ')} ms)` });
  }
  const hidden = [...images.pendingHidden, ...images.failedHidden];
  if (hidden.length > 0) {
    disclosures.push({ code: 'hidden-images-unloaded', detail: `${counted(hidden.length, 'hidden image', 'hidden images')} did not load (not painted; bytes refetched for the clone)`, dlIds: hidden });
  }
  return {
    ready: warnings.length === 0,
    promotedLazy: [...promoted],
    attempts,
    fonts,
    images: {
      total: images.total,
      pending: images.pendingVisible.length + images.pendingHidden.length,
      failed: images.failedVisible.length + images.failedHidden.length,
    },
    warnings,
    disclosures,
  };
}
