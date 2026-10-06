/**
 * Measured build lineage: how much of the captured clone's markup a build retained. It is never
 * self-described; ids come from the served HTML (template contents included) and the live open
 * shadow DOM. Pure except for {@link readCloneLineageInputs}.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import * as cheerio from 'cheerio';

import { sha256 } from '../capture/evidence.js';
import type { Manifest } from '../output/manifest.js';
import type { SkeletonToken } from './qa-probes.js';

export interface LineageViewport {
  viewport: string;
  cloneIds: number;
  retainedIds: number;
  retainedRatio: number;
  skeleton?: { clone: number[]; build: number[]; similarity: number };
}
export interface BuildLineage {
  schemaVersion: 1;
  generatedAt: string;
  url: string;
  project: string;
  mode: 'derive' | 'clone-base';
  clone: { indexSha256: string; dlIdCount: number };
  /** `capturedStyleBlocks`: inlined reference CSS blocks (`style[data-dl-captured-styles]`) still in the build. */
  build: { dlIdCount: number; capturedStyleBlocks?: number };
  viewports: LineageViewport[];
}

/** Unique `data-dl-id` values, including those inside `<template>` contents. */
export function htmlDlIds(html: string): Set<string> {
  const $ = cheerio.load(html);
  const ids = new Set<string>();
  $('[data-dl-id]').each((_, element) => {
    const id = $(element).attr('data-dl-id');
    if (id) ids.add(id);
  });
  return ids;
}

type Composition = NonNullable<Manifest['composition']>;

/** The capture variant used at `width`: nearest captured width, ties → the larger one. */
export function selectCaptureId(variants: Composition['variants'], width: number): string | null {
  let best: Composition['variants'][number] | null = null;
  for (const variant of variants) {
    if (!best) { best = variant; continue; }
    const distance = Math.abs(variant.viewport.width - width);
    const bestDistance = Math.abs(best.viewport.width - width);
    if (distance < bestDistance || (distance === bestDistance && variant.viewport.width > best.viewport.width)) best = variant;
  }
  return best?.captureId ?? null;
}

export function cloneIdsAt(composition: Composition | undefined, allIds: ReadonlySet<string>, width: number): Set<string> {
  if (!composition || composition.variants.length === 0) return new Set(allIds);
  const captureId = selectCaptureId(composition.variants, width);
  return new Set(composition.elements.filter((element) => element.captureId === captureId).map((element) => element.dlId));
}

export function lcsLength<T>(left: readonly T[], right: readonly T[]): number {
  const row = new Array<number>(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= right.length; j += 1) {
      const above = row[j];
      row[j] = left[i - 1] === right[j - 1] ? diagonal + 1 : Math.max(row[j], row[j - 1]);
      diagonal = above;
    }
  }
  return row[right.length];
}

/** LCS of the column sequences / the longer sequence (1 when both are empty). */
export function skeletonSimilarity(clone: readonly SkeletonToken[], build: readonly SkeletonToken[]): number {
  const longest = Math.max(clone.length, build.length);
  if (longest === 0) return 1;
  return Math.round((lcsLength(clone.map((token) => token.columns), build.map((token) => token.columns)) / longest) * 10_000) / 10_000;
}

export function retainedRatio(buildIds: ReadonlySet<string>, cloneIds: ReadonlySet<string>): { retained: number; ratio: number } {
  let retained = 0;
  for (const id of cloneIds) if (buildIds.has(id)) retained += 1;
  return { retained, ratio: cloneIds.size === 0 ? 0 : Math.round((retained / cloneIds.size) * 10_000) / 10_000 };
}

export interface CloneLineageInputs { indexSha256: string; ids: Set<string>; composition: Composition | undefined }

export async function readCloneLineageInputs(projectDir: string, manifest: Manifest | null): Promise<CloneLineageInputs> {
  const html = await fs.readFile(path.join(projectDir, 'clone', 'index.html'));
  return { indexSha256: sha256(html), ids: htmlDlIds(html.toString('utf8')), composition: manifest?.composition };
}
