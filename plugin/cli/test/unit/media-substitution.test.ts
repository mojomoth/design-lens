import { describe, expect, it } from 'vitest';

import { substituteMedia, type MediaFact } from '../../src/capture/media.js';

function fact(dlId: string, overrides: Partial<MediaFact> = {}): MediaFact {
  return {
    dlId, tag: 'video', painted: 'captured-frame', readyState: 4, currentTime: 3.204, played: true,
    controls: false, muted: true, sources: [], poster: null, ...overrides,
  };
}
const FRAME = 'data:image/png;base64,iVBORw0KGgo=';
const PAGE = 'https://example.com/en/index.html';

// why: the substitution is the only thing standing between a hero video and a permanently
// incomplete capture; it must keep every element, ID and poster, keep each source value verbatim
// (never an absolute URL the clone did not already contain), and never touch media it cannot
// reduce to a still.
describe('substituteMedia', () => {
  // why: the played-video case from the motivating captures (frame poster + two live sources).
  it('moves video and <source> sources aside for a captured frame and records absolute URLs', () => {
    const html = `<html><head></head><body><video data-dl-id="dl-1" data-dl-original-poster="poster.jpg" poster="${FRAME}" muted>`
      + '<source data-dl-id="dl-2" src="media/hero.webm" type="video/webm"><source data-dl-id="dl-3" src="/media/hero.mp4"></video></body></html>';
    const result = substituteMedia(html, [fact('dl-1')], PAGE);
    expect(result.unsubstituted).toEqual([]);
    expect(result.html).toContain('<source data-dl-id="dl-2" type="video/webm" data-dl-original-src="media/hero.webm">');
    expect(result.html).toContain('<source data-dl-id="dl-3" data-dl-original-src="/media/hero.mp4">');
    expect(result.html).not.toMatch(/\ssrc=/);
    expect(result.html).toContain(`poster="${FRAME}"`);
    expect(result.html).toContain('data-dl-original-poster="poster.jpg"');
    expect(result.substitutions).toEqual([{
      kind: 'video-frame', referencedBy: 'dl-1', stillFrom: 'captured-frame', currentTime: 3.2,
      urls: ['https://example.com/en/media/hero.webm', 'https://example.com/media/hero.mp4'],
      lost: ['motion', 'source-alternatives'],
    }]);
  });

  // why: a frame the serializer could not draw must not leave an empty box; the original poster
  // returns and the live source stays (remote, so the capture is honestly incomplete).
  it('restores the original poster and keeps sources when no frame was serialized', () => {
    const html = '<html><body><video data-dl-id="dl-1" data-dl-original-poster="poster.jpg" src="a.webm"></video></body></html>';
    const result = substituteMedia(html, [fact('dl-1')], PAGE);
    expect(result.substitutions).toEqual([]);
    expect(result.unsubstituted).toEqual(['dl-1']);
    expect(result.html).toContain('<video data-dl-id="dl-1" src="a.webm" poster="poster.jpg">');
  });

  // why: posters and hidden media are stills already; `none` must stay exactly as before.
  it('substitutes poster-showing and invisible media but never media that paints nothing', () => {
    const html = '<html><head><base href="https://cdn.example.com/assets/"></head><body>'
      + '<video data-dl-id="dl-1" poster="p.png" src="v.mp4"></video><audio data-dl-id="dl-2" src="a.mp3"></audio>'
      + '<video data-dl-id="dl-3" src="dead.mp4"></video></body></html>';
    const result = substituteMedia(html, [
      fact('dl-1', { painted: 'poster-attr', played: false, currentTime: 0, muted: false }),
      fact('dl-2', { tag: 'audio', painted: 'invisible' }),
      fact('dl-3', { painted: 'none' }),
    ], PAGE);
    expect(result.substitutions.map((entry) => [entry.referencedBy, entry.kind, entry.stillFrom, entry.lost, entry.urls])).toEqual([
      ['dl-1', 'video-poster', 'poster-attr', ['motion', 'audio'], ['https://cdn.example.com/assets/v.mp4']],
      ['dl-2', 'media-hidden', 'none', ['audio'], ['https://cdn.example.com/assets/a.mp3']],
    ]);
    expect(result.html).toContain('<video data-dl-id="dl-1" poster="p.png" data-dl-original-src="v.mp4">');
    expect(result.html).toContain('<video data-dl-id="dl-3" src="dead.mp4">');
  });

  // why: a poster replaced by the painted frame is no longer localized; keeping an absolute value
  // would write a new live origin URL into clone/ (the sealed no-origin-reference check).
  it('drops an absolute replaced poster but keeps a relative one as a note', () => {
    const html = `<html><body><video data-dl-id="dl-1" data-dl-original-poster="https://example.com/p.jpg" poster="${FRAME}" src="a.webm"></video>`
      + `<video data-dl-id="dl-2" data-dl-original-poster="//cdn.example.com/p.jpg" poster="${FRAME}" src="b.webm"></video>`
      + `<video data-dl-id="dl-3" data-dl-original-poster="img/p.jpg" poster="${FRAME}" src="c.webm"></video></body></html>`;
    const result = substituteMedia(html, [fact('dl-1'), fact('dl-2'), fact('dl-3')], PAGE);
    expect(result.substitutions.map((entry) => entry.kind)).toEqual(['video-frame', 'video-frame', 'video-frame']);
    expect(result.html).not.toContain('example.com');
    expect(result.html).toContain('data-dl-original-poster="img/p.jpg"');
    expect(result.html.match(/data-dl-original-poster=/g)).toHaveLength(1);
  });

  // why: pages without substitutable media must pass through byte-identical (no re-serialization).
  it('returns the input unchanged when there is nothing to substitute', () => {
    const html = '<!DOCTYPE html><html><body><video data-dl-id="dl-1" src="x.mp4"></video></body></html>';
    expect(substituteMedia(html, [fact('dl-1', { painted: 'none' })], PAGE)).toEqual({ html, substitutions: [], unsubstituted: [] });
  });
});
