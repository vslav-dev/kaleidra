import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import changelog from './changelog.json' with { type: 'json' };
import pkg from './package.json' with { type: 'json' };

/** Releases the update notice lists at most: enough for anyone who skipped a few. */
const NOTICE_RELEASES = 20;
/**
 * How often a running game asks for `version.json`, minutes. Games follow it from their next ask, so a deploy
 * that changes it reaches every open game within one old period. Each game asks once per period:
 * requests per second ≈ players online / (60 × minutes). At 1 minute, 100 requests/s is ~6 000 players at once;
 * raise it as the audience grows (10 → ~60 000, 30 → ~180 000 at the same 100/s).
 */
const CHECK_EVERY_MINUTES = 1;

/**
 * HOW TO WRITE changelog.json LINES. Players read them in the update notice, so every line must be understood
 * by almost anyone at a glance, a child or a grandparent who just plays:
 * - Russian, one short sentence, ideally under 50 characters; one change per line, 1–3 lines per release.
 * - Only what the player sees, hears or does; never how it works inside.
 * - Everyday words, no game jargon: «бонус», not «спецфишка», «комбо», «каскад»; no «генератор», «телеметрия», «рендер».
 * - Say the new state, not the old one: «Взрыв идёт оттуда, где ты коснулся», not «…а не оттуда, куда…».
 * - No numbers, conditions or exceptions unless the player needs them; no «теперь», «улучшен», «оптимизирован» filler.
 * - Nothing the player would notice? One line «Мелкие улучшения».
 */
/**
 * Serves `version.json`: the live version and what the latest releases changed. The game polls it to notice
 * an update. A static file, revalidated with a conditional GET (304 while unchanged): the server does nothing else.
 * The build fails when the version has no changelog entry, so every release says what it changed.
 */
function versionFile(): Plugin {
  const source = (): string =>
    JSON.stringify({ version: pkg.version, checkEveryMinutes: CHECK_EVERY_MINUTES, releases: changelog.slice(0, NOTICE_RELEASES) });
  return {
    name: 'version-file',
    buildStart() {
      if (changelog[0]?.version !== pkg.version) this.error(`changelog.json has no entry for ${pkg.version} on top`);
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: source() });
    },
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(source());
      });
    },
  };
}


export default defineConfig({
  base: './',
  plugins: [versionFile()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // 4214: next free port after Glimmerfall's 4213.
  server: { port: 4214, strictPort: true, host: true },
  preview: { port: 4214, strictPort: true, host: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
