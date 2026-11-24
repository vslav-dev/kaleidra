/**
 * Diagnostics sent to the MegaApp ingest (source `kaleidra`) through games.vslav.dev, whose nginx adds
 * the ingest key: the game ships no secret. Streams: `session` (device, missing features), `gl` (renderer),
 * `error` (uncaught errors), `debug` (targeted logs, added per investigation and removed after it).
 * Dev builds print to the console instead of sending.
 */
// Relative: the game lives under its own path (games.vslav.dev/kaleidra/), and so does the ingest.
const ENDPOINT = './api/ingest/kaleidra';
const SENDING = import.meta.env.PROD;
const FLUSH_DELAY = 2000;
const RETRY_DELAY = 30_000;
const MAX_QUEUE = 500;
const MAX_BATCH = 100;
const MAX_STACK = 2000;
/** the same error repeating every frame must not flood the queue */
const MAX_SAME_ERROR = 5;
const DEVICE_KEY = 'kd-device';

type Data = Record<string, unknown>;

interface TelemetryEvent {
  id: string;
  stream: string;
  at: number;
  data: Data;
}

/** Canvas and platform features the game relies on; the session event lists the missing ones. */
const FEATURES: [string, () => boolean][] = [
  ['roundRect', () => 'roundRect' in CanvasRenderingContext2D.prototype],
  ['conicGradient', () => 'createConicGradient' in CanvasRenderingContext2D.prototype],
  ['structuredClone', () => typeof structuredClone === 'function'],
  ['resizeObserver', () => typeof ResizeObserver === 'function'],
  ['cssInset', () => CSS.supports('inset', '0')],
  ['sendBeacon', () => typeof navigator.sendBeacon === 'function'],
];

const session = randomId();
let seq = 0;
let queue: TelemetryEvent[] = [];
/** events lost to the queue cap since the last delivered batch */
let dropped = 0;
let timer = 0;
let inFlight = false;
const errorCounts = new Map<string, number>();

export function track(stream: string, data: Data): void {
  if (!SENDING) {
    console.debug(`📡 ${stream} ${JSON.stringify(data)}`);
    return;
  }
  if (queue.length >= MAX_QUEUE) {
    dropped++;
    return;
  }
  queue.push({ id: `${session}:${++seq}`, stream, at: Date.now(), data });
  schedule(FLUSH_DELAY);
}

/** A targeted diagnostic line; `tag` names the place in code. */
export function debug(tag: string, data: Data = {}): void {
  track('debug', { tag, ...data });
}

/** Call first thing at startup, so boot errors are caught too. */
export function startTelemetry(): void {
  track('session', {
    version: __APP_VERSION__,
    device: deviceId(),
    ua: navigator.userAgent,
    lang: navigator.language,
    /** minutes ahead of UTC: event times read as the player's local hour */
    tz: -new Date().getTimezoneOffset(),
    screen: [screen.width, screen.height],
    viewport: [innerWidth, innerHeight],
    dpr: devicePixelRatio,
    cores: navigator.hardwareConcurrency,
    memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    gamut: ['rec2020', 'p3', 'srgb'].find((g) => matchMedia(`(color-gamut: ${g})`).matches) ?? null,
    hdr: matchMedia('(dynamic-range: high)').matches,
    missing: FEATURES.filter(([, has]) => !safe(has)).map(([name]) => name),
  });
  addEventListener('error', (e) => reportError(e.error ?? e.message, `${e.filename}:${e.lineno}:${e.colno}`));
  addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'));
  // Old Safari skips visibilitychange on unload; pagehide covers it. The second call finds an empty queue.
  // On window, not document: the event bubbles up from document, so events queued by document listeners
  // (the perf window sent on hide) go out with this beacon.
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') beacon();
  });
  addEventListener('pagehide', beacon);
}

function reportError(error: unknown, where: string): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const count = (errorCounts.get(message) ?? 0) + 1;
  errorCounts.set(message, count);
  if (count > MAX_SAME_ERROR) return;
  const stack = error instanceof Error ? error.stack?.slice(0, MAX_STACK) : undefined;
  track('error', { message, where, stack, count });
}

// ---------- delivery ----------

function schedule(delay: number): void {
  if (timer || inFlight) return;
  timer = window.setTimeout(() => void flush(), delay);
}

/** Posts one batch. Network errors and 5xx keep it for a retry; 2xx and 4xx close it. */
async function flush(): Promise<void> {
  timer = 0;
  if (queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);
  const lost = dropped;
  dropped = 0;
  inFlight = true;
  let retry: boolean;
  try {
    // A string body is text/plain: a simple request, no CORS preflight.
    const response = await fetch(ENDPOINT, { method: 'POST', body: JSON.stringify({ events: batch, dropped: lost }) });
    retry = response.status >= 500 || response.status === 429;
  } catch {
    retry = true;
  }
  inFlight = false;
  if (retry) {
    queue = [...batch, ...queue];
    dropped += lost + Math.max(0, queue.length - MAX_QUEUE);
    queue.length = Math.min(queue.length, MAX_QUEUE);
  }
  if (queue.length > 0) schedule(retry ? RETRY_DELAY : FLUSH_DELAY);
}

/** The page may be gone before a fetch answers; a beacon survives it. */
function beacon(): void {
  if (!SENDING || queue.length === 0 || typeof navigator.sendBeacon !== 'function') return;
  const batch = queue.slice(0, MAX_BATCH);
  if (navigator.sendBeacon(ENDPOINT, JSON.stringify({ events: batch, dropped }))) {
    queue.splice(0, batch.length);
    dropped = 0;
  }
}

// ---------- helpers ----------

function randomId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Stable per install, to tell one device's sessions apart from another's. */
function deviceId(): string {
  try {
    const known = localStorage.getItem(DEVICE_KEY);
    if (known) return known;
    const id = randomId();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return 'unknown';
  }
}

function safe(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}
