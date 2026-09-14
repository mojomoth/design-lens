/** CSS-pixel viewport shared by capture and inspection. */
export interface Viewport {
  width: number;
  height: number;
}

/** Reject invalid geometry before a server or Chromium process is started. */
export function parseViewport(raw: string): Viewport {
  const match = /^(\d+)x(\d+)$/i.exec(raw.trim());
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`invalid --viewport "${raw}"; expected positive integer dimensions like 1440x900`);
  }
  return { width, height };
}
