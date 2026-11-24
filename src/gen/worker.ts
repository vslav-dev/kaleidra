import { draftLevel, type DraftRequest } from '@/gen/generator';

/** Level drafting runs here: bot calibration takes up to a few hundred ms and must not block the UI. */
self.onmessage = (e: MessageEvent<DraftRequest & { id: number }>) => {
  const { id, ...req } = e.data;
  try {
    self.postMessage({ id, draft: draftLevel(req) });
  } catch (error) {
    // Worker errors never reach the page's error listener: the page rethrows them, so telemetry sees them.
    self.postMessage({ id, error: error instanceof Error ? `${error.name}: ${error.message}\n${error.stack}` : String(error) });
  }
};
