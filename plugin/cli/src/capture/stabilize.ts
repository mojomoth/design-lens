/// <reference lib="dom" />

import type { Frame, Page } from 'playwright';
import type { FontReadiness } from './browser.js';
import { counted, type CaptureDisclosure } from './disclosures.js';
import type { MediaPolicy } from './media.js';
import { awaitReadiness, LEGACY_READINESS, type ReadinessPolicy, type ReadinessResult } from './readiness.js';

export interface StabilizationResult {
  complete: boolean;
  warnings: string[];
  fonts: FontReadiness;
  images: { total: number; pending: number; failed: number };
  animations: { frozen: number; unsupported: number };
  readiness: ReadinessResult;
  /** What the freeze stopped; SMIL and marquee entries are element IDs. */
  frozen: { raf: boolean; timers: boolean; media: number; smil: string[]; marquee: string[] };
  disclosures: CaptureDisclosure[];
}

export interface StabilizeOptions {
  activeResponsiveOnly?: boolean;
  /** Omitted fields keep {@link LEGACY_READINESS}. */
  readiness?: Partial<ReadinessPolicy>;
  /** Under `poster`, only a VISIBLE video without a frame or poster paints nothing capturable. */
  media?: MediaPolicy;
}

interface FreezeResult {
  warnings: string[];
  animations: { frozen: number; unsupported: number };
  frozen: StabilizationResult['frozen'];
}

/**
 * Fix the capture state before both serialization and screenshots. Readiness runs first with
 * native timers and RAF; then animated values are persisted in ordinary styles, because paused
 * browser animation objects do not survive inert HTML replay. SMIL documents are paused where they
 * stand (rewinding would paint fade-ins at their invisible start); their document time is kept in
 * `data-dl-smil-time` so the clone re-render can show the same still. Marquees are stopped.
 */
export async function stabilize(
  page: Page | Frame, deadline: number, options: StabilizeOptions = {},
): Promise<StabilizationResult> {
  const activeResponsiveOnly = options.activeResponsiveOnly === true;
  const readiness = await awaitReadiness(page, deadline, { ...LEGACY_READINESS, ...options.readiness }, { activeResponsiveOnly });
  const freeze = await page.evaluate(freezeCaptureState, { deadline, activeResponsiveOnly, posterMedia: options.media === 'poster' });
  const warnings = [...readiness.warnings, ...freeze.warnings];
  const disclosures = [...readiness.disclosures];
  if (freeze.frozen.smil.length > 0) {
    disclosures.push({ code: 'smil-paused', detail: `${counted(freeze.frozen.smil.length, 'SMIL-animated SVG document was', 'SMIL-animated SVG documents were')} paused where they stood; their motion is not reproduced`, dlIds: freeze.frozen.smil });
  }
  if (freeze.frozen.marquee.length > 0) {
    disclosures.push({ code: 'marquee-stopped', detail: `${counted(freeze.frozen.marquee.length, 'marquee element was', 'marquee elements were')} stopped; their motion is not reproduced`, dlIds: freeze.frozen.marquee });
  }
  return {
    complete: warnings.length === 0, warnings, fonts: readiness.fonts, images: readiness.images,
    animations: freeze.animations, readiness, frozen: freeze.frozen, disclosures,
  };
}

/** Runs inside Chromium; all runtime values deliberately live inside the callback. */
async function freezeCaptureState(
  { deadline, activeResponsiveOnly, posterMedia }: { deadline: number; activeResponsiveOnly: boolean; posterMedia: boolean },
): Promise<FreezeResult> {
  const warnings: string[] = [];
  const roots: Array<Document | ShadowRoot> = [document];
  const elements: Element[] = [];
  const stack = document.body ? [document.body as Element] : [];
  while (stack.length > 0) {
    // Readiness may already have used the deadline; the freeze below must still run.
    if (elements.length >= 20_000) {
      warnings.push('stabilization element limit or deadline reached');
      break;
    }
    const element = stack.pop()!;
    if (activeResponsiveOnly && element.getAttribute('data-dl-generated') === 'host'
        && element.shadowRoot && getComputedStyle(element).display === 'none') continue;
    elements.push(element);
    stack.push(...Array.from(element.children));
    if (element.shadowRoot) {
      roots.push(element.shadowRoot);
      stack.push(...Array.from(element.shadowRoot.children));
    }
  }
  const runtime = (window as unknown as { __designLensCaptureRuntime?: {
    freezeRaf(): void; freezeTimers?(): void; sleep?(ms: number): Promise<void>;
  } }).__designLensCaptureRuntime;
  // After a timer freeze only the runtime's native timer still resolves.
  const pause = (ms: number): Promise<void> => runtime?.sleep
    ? runtime.sleep(Math.max(0, ms))
    : new Promise((resolve) => { window.setTimeout(resolve, Math.max(0, ms)); });
  // Lazy content and resource readiness ran with native RAF first. Page timers are frozen only
  // when the capture installed timer wrappers; otherwise continuing mutations remain observable.
  runtime?.freezeRaf();
  runtime?.freezeTimers?.();
  const frozen: FreezeResult['frozen'] = {
    raf: runtime !== undefined, timers: typeof runtime?.freezeTimers === 'function', media: 0, smil: [], marquee: [],
  };
  for (const element of elements) {
    if (element instanceof HTMLMediaElement) {
      element.pause();
      frozen.media += 1;
      if (element instanceof HTMLVideoElement && !element.poster && element.readyState < 2) {
        const box = element.getBoundingClientRect();
        const visible = box.width > 0 && box.height > 0 && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
        if (!posterMedia || visible) warnings.push('video has no paintable frame or poster');
      }
    }
  }

  const animationResult = { frozen: 0, unsupported: 0 };
  const animations = new Set<Animation>();
  for (const root of roots) for (const animation of root.getAnimations()) animations.add(animation);
  let frozenId = 0;
  const frozenTargets = new Map<Element, string>();
  for (const animation of animations) {
    if (Date.now() >= deadline || animationResult.frozen + animationResult.unsupported >= 20_000) {
      warnings.push('animation stabilization limit or deadline reached');
      break;
    }
    try {
      const effect = animation.effect;
      if (!(effect instanceof KeyframeEffect) || !(effect.target instanceof Element)) {
        animation.pause();
        animationResult.unsupported += 1;
        continue;
      }
      const target = effect.target;
      const pseudo = effect.pseudoElement;
      const timing = effect.getComputedTiming();
      if (Number.isFinite(Number(timing.endTime))) animation.finish();
      else { animation.pause(); animation.currentTime = 0; }
      const keys = new Set(effect.getKeyframes().flatMap((frame) => Object.keys(frame)));
      for (const metadata of ['offset', 'computedOffset', 'easing', 'composite']) keys.delete(metadata);
      const computed = getComputedStyle(target, pseudo);
      const values: Array<[string, string]> = [];
      for (const key of keys) {
        const property = key.startsWith('--') ? key : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        const value = computed.getPropertyValue(property);
        if (value) values.push([property, value]);
        else animationResult.unsupported += 1;
      }
      if (pseudo) {
        let id = frozenTargets.get(target);
        if (!id) {
          frozenId += 1;
          id = `dl-frozen-${frozenId}`;
          frozenTargets.set(target, id);
        }
        target.setAttribute('data-dl-frozen', id);
        const sheet = document.createElement('style');
        sheet.setAttribute('data-dl-stabilized', '');
        sheet.textContent = `[data-dl-frozen="${id}"]${pseudo}{${values.map(([property, value]) => `${property}:${value}!important;`).join('')}}`;
        const root = target.getRootNode();
        if (root instanceof ShadowRoot) root.append(sheet);
        else (document.head ?? document.documentElement).append(sheet);
      } else {
        const style = (target as HTMLElement | SVGElement).style;
        if (!style) { animationResult.unsupported += 1; continue; }
        for (const [property, value] of values) style.setProperty(property, value, 'important');
      }
      animation.cancel();
      animationResult.frozen += 1;
    } catch {
      animationResult.unsupported += 1;
    }
  }
  // Covers newly-created CSS animations and pseudo-elements without an exposed KeyframeEffect.
  const globalFreeze = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
  for (const root of roots) {
    const parent = root instanceof ShadowRoot ? root : (document.head ?? document.documentElement);
    // A repeated stabilization (capture attempts) must not stack identical sheets.
    if (Array.from(parent.children).some((child) => child.localName === 'style'
        && child.hasAttribute('data-dl-stabilized') && child.textContent === globalFreeze)) continue;
    const sheet = document.createElement('style');
    sheet.setAttribute('data-dl-stabilized', '');
    sheet.textContent = globalFreeze;
    parent.append(sheet);
  }
  if (animationResult.unsupported > 0) warnings.push(`${animationResult.unsupported} animation effects could not be persisted reliably`);
  for (const root of roots) {
    for (const svg of Array.from(root.querySelectorAll('svg'))) {
      if (!(svg instanceof SVGSVGElement) || svg.parentElement?.closest('svg')) continue;
      if (!svg.querySelector('animate, animateTransform, animateMotion, set')) continue;
      // A recorded source time (from an earlier pause, serialized into the clone) is restored so
      // a re-render shows the same still; a first pause never seeks.
      const recorded = Number(svg.getAttribute('data-dl-smil-time') ?? Number.NaN);
      if (Number.isFinite(recorded) && recorded >= 0) svg.setCurrentTime(recorded);
      svg.pauseAnimations();
      svg.setAttribute('data-dl-smil-time', String(svg.getCurrentTime()));
      frozen.smil.push(svg.getAttribute('data-dl-id') ?? '(unstamped svg)');
    }
    for (const marquee of Array.from(root.querySelectorAll('marquee'))) {
      const stop: unknown = Reflect.get(marquee, 'stop');
      if (typeof stop !== 'function') continue;
      stop.call(marquee);
      frozen.marquee.push(marquee.getAttribute('data-dl-id') ?? '(unstamped marquee)');
    }
  }

  window.scrollTo(0, 0);
  // A short observation catches active scripts that keep changing the supposed static state.
  let mutations = 0;
  const observers = roots.map((root) => {
    const observer = new MutationObserver((records) => { mutations += records.length; });
    observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
    return observer;
  });
  await pause(Math.min(100, Math.max(0, deadline - Date.now())));
  observers.forEach((observer) => observer.disconnect());
  if (mutations > 0) warnings.push(`page still changed after animation freeze (${mutations} DOM mutations)`);
  if (Date.now() >= deadline) warnings.push('capture stabilization deadline reached');
  return { warnings, animations: animationResult, frozen };
}

export const stabilizePage = stabilize;
