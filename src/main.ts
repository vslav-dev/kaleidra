import '@/ui/styles.css';
import { GameApp } from '@/app/app';
import { Scene } from '@/view/scene';

const root = document.getElementById('app')!;
const canvas = root.querySelector<HTMLCanvasElement>('#board')!;
const scene = await Scene.create(canvas);
new GameApp(root, scene, canvas).init();
