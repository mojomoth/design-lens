/// <reference lib="dom" />

import type { Frame, Page } from 'playwright';
import type { FontReadiness } from './browser.js';

export interface StabilizationResult {
  complete: boolean;
  warnings: string[];
  fonts: FontReadiness;
  images: { total: number; pending: number; failed: number };
  animations: { frozen: number; unsupported: number };
}

/**
 * Fix the capture state before both serialization and screenshots. Animated values are persisted
 * in ordinary styles, because paused browser animation objects do not survive inert HTML replay.
 */
export async function stabilize(page: Page | Frame, deadline: number): Promise<StabilizationResult> {
  return page.evaluate(async (deadline): Promise<StabilizationResult> => {
    const warnings: string[] = [];
    const roots: Array<Document | ShadowRoot> = [document];
    const elements: Element[] = [];
    const stack = document.body ? [document.body as Element] : [];
    while (stack.length > 0) {
      if (elements.length >= 20_000 || Date.now() >= deadline) {
        warnings.push('stabilization element limit or deadline reached');
        break;
      }
      const element = stack.pop()!;
      elements.push(element);
      stack.push(...Array.from(element.children));
      if (element.shadowRoot) {
        roots.push(element.shadowRoot);
        stack.push(...Array.from(element.shadowRoot.children));
      }
    }
    const pause = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
    const budget = Math.min(5_000, Math.max(0, deadline - Date.now()));
    let fontTimer: number | undefined;
    const fontResult = document.fonts ? await Promise.race([
      document.fonts.ready.then(() => 'ready' as const),
      new Promise<'timeout'>((resolve) => { fontTimer = window.setTimeout(() => resolve('timeout'), budget); }),
    ]) : 'unavailable' as const;
    if (fontTimer !== undefined) window.clearTimeout(fontTimer);
    const failedFamilies = new Set<string>();
    document.fonts?.forEach((face) => { if (face.status === 'error') failedFamilies.add(face.family); });
    const fonts: FontReadiness = { status: fontResult, failedFamilies: [...failedFamilies].sort() };
    if (fontResult !== 'ready') warnings.push(`font readiness ${fontResult}`);
    if (failedFamilies.size > 0) warnings.push(`failed font families: ${[...failedFamilies].sort().join(', ')}`);

    const images = elements.filter((element): element is HTMLImageElement => element instanceof HTMLImageElement && Boolean(element.currentSrc || element.getAttribute('src')));
    const imageDeadline = Math.min(deadline, Date.now() + 5_000);
    while (images.some((image) => !image.complete) && Date.now() < imageDeadline) await pause(Math.min(25, imageDeadline - Date.now()));
    const imageResult = {
      total: images.length,
      pending: images.filter((image) => !image.complete).length,
      failed: images.filter((image) => image.complete && image.naturalWidth === 0).length,
    };
    if (imageResult.pending > 0) warnings.push(`${imageResult.pending} image loads exceeded capture readiness budget`);
    if (imageResult.failed > 0) warnings.push(`${imageResult.failed} images failed to load`);
    // Lazy content and resource readiness must run with native RAF first. Timers stay live so
    // measurement/serialization can finish and continuing non-RAF mutations remain observable.
    (window as unknown as { __designLensCaptureRuntime?: { freezeRaf(): void } })
      .__designLensCaptureRuntime?.freezeRaf();
    for (const element of elements) {
      if (element instanceof HTMLMediaElement) {
        element.pause();
        if (element instanceof HTMLVideoElement && !element.poster && element.readyState < 2) warnings.push('video has no paintable frame or poster');
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
    for (const root of roots) {
      const sheet = document.createElement('style');
      sheet.setAttribute('data-dl-stabilized', '');
      sheet.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
      if (root instanceof ShadowRoot) root.append(sheet);
      else (document.head ?? document.documentElement).append(sheet);
    }
    if (animationResult.unsupported > 0) warnings.push(`${animationResult.unsupported} animation effects could not be persisted reliably`);

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
    return { complete: warnings.length === 0, warnings, fonts, images: imageResult, animations: animationResult };
  }, deadline);
}

export const stabilizePage = stabilize;
