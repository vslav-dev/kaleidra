/** One release as the changelog tells it. */
export interface Release {
  version: string;
  /** ISO date */
  date: string;
  changes: string[];
}

/** A newer build is live: its version, and what changed since the one running here, newest first. */
export interface Update {
  version: string;
  releases: Release[];
}

/** What `version.json` holds: the live version, how often to ask again, and the latest releases. */
interface VersionFile {
  version: string;
  checkEveryMinutes: number;
  releases: Release[];
}

/** Until the first answer comes, and the bounds an answer's period is kept within, minutes. */
const DEFAULT_MINUTES = 1;
const MIN_MINUTES = 0.5;
const MAX_MINUTES = 240;
/** each wait is spread by ±this share, so games opened together do not ask together */
const JITTER = 0.2;

/**
 * Notices a new build without bothering the server: `version.json` is a static file, asked with a conditional GET
 * (a few hundred bytes, answered 304 while nothing changed; the browser then hands over its cached copy).
 * How often to ask comes in the file itself, so a deploy can slow every open game down as the audience grows.
 * It asks at start, then once per period while the game is in front, and at once on return to the front when
 * a period has passed. No connection is kept open. Once an update is found it stops asking.
 */
export class UpdateWatch {
  private minutes = DEFAULT_MINUTES;
  private last = 0;
  private timer = 0;
  private found = false;

  public constructor(
    private readonly current: string,
    private readonly onUpdate: (update: Update) => void,
  ) {}

  public start(): void {
    void this.check();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && performance.now() - this.last > this.periodMs()) void this.check();
    });
  }

  private async check(): Promise<void> {
    window.clearTimeout(this.timer);
    if (this.found) return;
    // A game in the background does not ask; it asks on return instead.
    if (document.visibilityState !== 'visible') return;
    this.last = performance.now();
    try {
      // `no-cache` revalidates: the browser sends its ETag and the server answers 304 while the file is the same.
      const response = await fetch('./version.json', { cache: 'no-cache' });
      if (response.ok) this.read((await response.json()) as VersionFile);
    } catch {
      // Offline or a deploy mid-way: the next look tries again.
    }
    if (!this.found) this.timer = window.setTimeout(() => void this.check(), this.periodMs() * (1 + JITTER * (2 * Math.random() - 1)));
  }

  private read(live: VersionFile): void {
    if (Number.isFinite(live.checkEveryMinutes)) this.minutes = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, live.checkEveryMinutes));
    if (compareVersions(live.version, this.current) <= 0) return;
    this.found = true;
    this.onUpdate({ version: live.version, releases: live.releases.filter((r) => compareVersions(r.version, this.current) > 0) });
  }

  private periodMs(): number {
    return this.minutes * 60_000;
  }
}

/** Compares `major.minor.patch` versions: negative, 0 or positive like a sort comparator. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let k = 0; k < Math.max(pa.length, pb.length); k++) {
    const d = (pa[k] ?? 0) - (pb[k] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
