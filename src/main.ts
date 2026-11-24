import '@/ui/styles.css';
import { GameApp } from '@/app/app';
import { startPerf, trackBoot } from '@/telemetry/perf';
import { startTelemetry } from '@/telemetry/telemetry';
import { Scene } from '@/view/scene';

startTelemetry();
startPerf();

const root = document.getElementById('app')!;
const canvas = root.querySelector<HTMLCanvasElement>('#board')!;
const scene = await Scene.create(canvas);
const sceneAt = performance.now();
new GameApp(root, scene, canvas).init();
trackBoot(sceneAt);

// Offline support and install to the home screen.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('./sw.js');
}
