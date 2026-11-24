import type { DraftRequest, LevelDraft } from '@/gen/generator';

const CACHE_SIZE = 4;

type Reply = { id: number; draft: LevelDraft } | { id: number; error: string };

/** Main-thread side of the generation worker, with a small cache so the next level can be prefetched. */
export class LevelDrafts {
  private readonly worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private readonly cache = new Map<string, Promise<LevelDraft>>();
  private readonly pending = new Map<number, { resolve: (draft: LevelDraft) => void; reject: (error: Error) => void }>();
  private nextId = 1;

  public constructor() {
    this.worker.onmessage = (e: MessageEvent<Reply>) => {
      const reply = e.data;
      const request = this.pending.get(reply.id);
      this.pending.delete(reply.id);
      if ('draft' in reply) request?.resolve(reply.draft);
      else request?.reject(new Error(`level draft failed: ${reply.error}`));
    };
  }

  /** The first request for a level fixes the style it is built for: a prefetch is not rebuilt when the style drifts. */
  public get(req: DraftRequest): Promise<LevelDraft> {
    const key = `${req.seed}:${req.number}`;
    let draft = this.cache.get(key);
    if (!draft) {
      const id = this.nextId++;
      draft = new Promise<LevelDraft>((resolve, reject) => this.pending.set(id, { resolve, reject }));
      // A failed draft is not cached: the next request tries again.
      draft.catch(() => this.cache.delete(key));
      this.worker.postMessage({ id, ...req });
      this.cache.set(key, draft);
      if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    }
    return draft;
  }
}
