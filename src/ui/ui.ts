import type { Update } from '@/app/updates';
import { type GameState, type LevelDef, LevelKind, type Objective, ObjectiveKind, Special } from '@/core/types';
import { FrameName, frameDataUrl } from '@/view/art';
import { S } from '@/ui/strings';

export const Action = {
  Play: 'play',
  Shapes: 'shapes',
  Settings: 'settings',
  Pause: 'pause',
  Resume: 'resume',
  Restart: 'restart',
  Menu: 'menu',
  Back: 'back',
  Goals: 'goals',
  CloseHelp: 'close-help',
  Next: 'next',
  Retry: 'retry',
  Sound: 'sound',
  Haptics: 'haptics',
  Easier: 'easier',
  Harder: 'harder',
  Reset: 'reset',
  Star: 'star',
  Meteor: 'meteor',
  GiveUp: 'give-up',
  Update: 'update',
  UpdateLater: 'update-later',
  ApplyUpdate: 'apply-update',
} as const;
export type Action = (typeof Action)[keyof typeof Action];

export interface SettingsView {
  sound: boolean;
  haptics: boolean;
  difficulty: string;
}

const STAR_PATH = 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z';
const PAUSE_ICON = '<svg viewBox="0 0 20 20"><rect x="4" y="3" width="4.5" height="14" rx="1.5"/><rect x="11.5" y="3" width="4.5" height="14" rx="1.5"/></svg>';
const GEAR_ICON =
  '<svg viewBox="0 0 24 24"><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';

/** The DOM over the board: screens, HUD, messages. It shows state; every decision goes back through `onAction`. */
export class Ui {
  private readonly hud: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly praiseEl: HTMLElement;
  private readonly curtainEl: HTMLElement;
  private readonly icons = new Map<string, string>();
  private hudDef: LevelDef | null = null;
  private shown = { moves: -1, score: -1, progress: [] as number[] };

  public constructor(
    root: HTMLElement,
    private readonly onAction: (action: Action) => void,
  ) {
    this.hud = root.querySelector('#hud')!;
    this.overlay = root.querySelector('#overlay')!;
    this.praiseEl = root.querySelector('#praise')!;
    this.curtainEl = root.querySelector('#curtain')!;
    root.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (target) this.onAction(target.dataset.action as Action);
    });
    document.body.insertAdjacentHTML('afterbegin', mandala());
  }

  public icon(frame: string, size = 72): string {
    let url = this.icons.get(frame);
    if (!url) {
      url = frameDataUrl(frame, size);
      this.icons.set(frame, url);
    }
    return url;
  }

  public setTheme(level: number): void {
    document.documentElement.dataset.theme = String(Math.floor((level - 1) / 20) % 5);
  }

  // ---------- screens ----------

  public showTitle(level: number, resumable: boolean, update: boolean): void {
    this.setTheme(level);
    this.open(
      `<div class="title-screen">
        <button class="btn icon corner" data-action="${Action.Settings}" aria-label="${S.settings}">${GEAR_ICON}</button>
        ${rosette(this)}
        <h1 class="logo">${S.title}</h1>
        <p class="tagline">${S.tagline}</p>
        <button class="btn primary big" data-action="${Action.Play}">${resumable ? S.resume(level) : S.play(level)}</button>
        <button class="btn ghost" data-action="${Action.Shapes}">${S.howTo}</button>
        ${update ? `<button class="btn ghost update-link" data-action="${Action.Update}">✨ ${S.update.button}</button>` : ''}
        <p class="version">v${__APP_VERSION__}</p>
      </div>`,
      true,
    );
  }

  public showPause(): void {
    this.open(
      `<div class="card">
        <h2>${S.paused}</h2>
        <button class="btn primary" data-action="${Action.Resume}">${S.continue}</button>
        <button class="btn" data-action="${Action.Goals}">${S.goals}</button>
        <button class="btn" data-action="${Action.Shapes}">${S.howTo}</button>
        <button class="btn" data-action="${Action.Settings}">${S.settings}</button>
        <button class="btn" data-action="${Action.Restart}">${S.restart}</button>
        <button class="btn ghost" data-action="${Action.Menu}">${S.menu}</button>
      </div>`,
    );
  }

  public showSettings(s: SettingsView): void {
    const toggle = (action: Action, label: string, on: boolean): string =>
      `<button class="toggle${on ? ' on' : ''}" data-action="${action}"><span>${label}</span><i>${on ? S.on : S.off}</i></button>`;
    this.open(
      `<div class="card">
        <h2>${S.settings}</h2>
        ${toggle(Action.Sound, S.sound, s.sound)}
        ${toggle(Action.Haptics, S.haptics, s.haptics)}
        <div class="toggle"><span>${S.difficulty}</span>
          <button class="btn icon" style="width:34px;height:34px" data-action="${Action.Easier}">−</button>
          <i>${S.difficulties[s.difficulty]}</i>
          <button class="btn icon" style="width:34px;height:34px" data-action="${Action.Harder}">+</button>
        </div>
        <button class="btn danger" data-action="${Action.Reset}">${S.reset}</button>
        <button class="btn ghost" data-action="${Action.Back}">${S.back}</button>
      </div>`,
    );
  }

  public confirmReset(): boolean {
    return window.confirm(S.confirmReset);
  }

  /** The goals explained, the blockers and rotors on this board, and a new mechanic's lesson on its intro level. */
  public showGoals(state: GameState): void {
    const def = state.level;
    const rows = def.objectives.map((o, k) => this.helpRow(this.goalIcon(o), goalText(o, Math.max(0, o.target - state.progress[k]))));
    const has = (layer: number[]): boolean => layer.some((v) => v > 0);
    const goalKinds = new Set(def.objectives.map((o) => o.kind));
    if (has(def.ice) && !goalKinds.has(ObjectiveKind.Ice)) rows.push(this.helpRow(this.img(FrameName.ice(1)), S.blocker.ice));
    if (has(def.crate) && !goalKinds.has(ObjectiveKind.Crate)) rows.push(this.helpRow(this.img(FrameName.crate(1)), S.blocker.crate));
    if (has(def.chain)) rows.push(this.helpRow(this.img(FrameName.chain(1)), S.blocker.chain));
    if (def.rotors.length > 0) rows.push(this.helpRow(rotorIcon(), S.blocker.rotor));
    if (def.objectives.length > 1) rows.push(`<p>${S.doubleGoal}</p>`);
    const badge = def.intro ? `<span class="badge">${S.intro[def.intro]}</span>` : '';
    this.open(
      `<div class="card help">
        ${badge}
        <h2>${S.goals}</h2>
        ${rows.join('')}
        <button class="btn primary" data-action="${Action.CloseHelp}">${S.gotIt}</button>
      </div>`,
    );
  }

  /** How the specials are made, with little hex diagrams of their shapes. */
  public showShapes(): void {
    const row = (cells: [number, number][], gem: string, text: string): string =>
      `<div class="help-row">${figure(cells)}<img src="${this.icon(gem)}" alt="">` + `<p>${text}</p></div>`;
    this.open(
      `<div class="card help">
        <h2>${S.howTo}</h2>
        <p>${S.shapes.intro}</p>
        ${row([[0, -1], [0, 0], [0, 1], [0, 2]], FrameName.gem(3, Special.Ray0), S.shapes.ray)}
        ${row([[0, -2], [0, -1], [0, 0], [1, -1], [2, -2]], FrameName.gem(0, Special.Burst), S.shapes.burst)}
        ${row([[0, -2], [0, -1], [0, 0], [1, 0], [2, 0], [-1, 1], [-2, 2]], FrameName.gem(4, Special.Nova), S.shapes.nova)}
        ${row([[0, -2], [0, -1], [0, 0], [0, 1], [0, 2]], FrameName.Prism, S.shapes.prism)}
        <p>${S.shapes.combo}</p>
        <h3>Бонусы</h3>
        ${this.helpRow(this.img(FrameName.FallingStar), S.boosters.star)}
        ${this.helpRow(this.img(FrameName.Meteor), S.boosters.meteor)}
        <button class="btn primary" data-action="${Action.CloseHelp}">${S.gotIt}</button>
      </div>`,
    );
  }

  public showWin(stars: number, score: number): void {
    const slots = [0, 1, 2]
      .map(
        (i) =>
          `<div class="star-slot" style="--i:${i}"><svg viewBox="0 0 24 24"><path class="outline" d="${STAR_PATH}"/>${i < stars ? `<path class="earned" d="${STAR_PATH}"/>` : ''}</svg></div>`,
      )
      .join('');
    this.open(
      `<div class="card">
        <h2>${S.won}</h2>
        <div class="stars">${slots}</div>
        <p class="score-line">${S.score}: <b>${score}</b></p>
        <button class="btn primary big" data-action="${Action.Next}">${S.next}</button>
        <button class="btn ghost" data-action="${Action.Menu}">${S.menu}</button>
      </div>`,
    );
  }

  public showLose(state: GameState): void {
    const goals = state.level.objectives
      .map((o, k) => `<div class="goal"><span>${this.goalIcon(o)}</span><b>${Math.min(state.progress[k], o.target)} / ${o.target}</b></div>`)
      .join('');
    this.open(
      `<div class="card">
        <h2>${state.movesLeft > 0 ? S.stuck : S.lost}</h2>
        <div class="hud-goals" style="margin:12px auto">${goals}</div>
        <button class="btn primary big" data-action="${Action.Retry}">${S.retry}</button>
        <button class="btn ghost" data-action="${Action.Menu}">${S.menu}</button>
      </div>`,
    );
  }

  /** What the new version brings, release by release since the one running here. */
  public showUpdate(current: string, update: Update): void {
    const releases = update.releases
      .map((r) => `<div class="release"><h3>${S.update.release(r.version, r.date)}</h3><ul>${r.changes.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul></div>`)
      .join('');
    this.open(
      `<div class="card update">
        <h2>${S.update.title}</h2>
        <p>${S.update.versions(current, update.version)}</p>
        <div class="releases">${releases}</div>
        <button class="btn primary big" data-action="${Action.ApplyUpdate}">${S.update.apply}</button>
        <button class="btn ghost" data-action="${Action.UpdateLater}">${S.update.later}</button>
      </div>`,
    );
  }

  public hideOverlay(): void {
    this.overlay.classList.remove('visible', 'title');
    this.overlay.innerHTML = '';
  }

  private open(html: string, title = false): void {
    this.overlay.innerHTML = html;
    this.overlay.classList.add('visible');
    this.overlay.classList.toggle('title', title);
  }

  // ---------- HUD ----------

  public showHud(def: LevelDef): void {
    this.hudDef = def;
    this.shown = { moves: -1, score: -1, progress: def.objectives.map(() => -1) };
    const marks = [0, 1, 2].map((k) => `<i class="mark" data-k="${k}"><svg viewBox="0 0 24 24"><path d="${STAR_PATH}"/></svg>${k > 0 ? `<span>${def.stars[k]}</span>` : ''}</i>`).join('');
    const goals = def.objectives.map((o, k) => `<div class="goal" data-k="${k}">${this.goalIcon(o)}<b></b></div>`).join('');
    this.hud.innerHTML = `
      <div class="hud-moves"><span class="value"></span><span class="label">${S.moves}</span></div>
      <div class="hud-goals" data-action="${Action.Goals}">${goals}</div>
      <button class="btn icon" data-action="${Action.Pause}" aria-label="${S.paused}">${PAUSE_ICON}</button>
      <div class="hud-score"><div class="bar"><div class="track"><div class="fill"></div>${marks}</div></div><div class="score">0</div></div>`;
    this.hud.classList.remove('off');
  }

  public hideHud(): void {
    this.hud.classList.add('off');
    this.hudDef = null;
  }

  public updateHud(state: GameState): void {
    const def = this.hudDef;
    if (!def || def !== state.level) return;
    const movesEl = this.hud.querySelector<HTMLElement>('.hud-moves')!;
    if (state.movesLeft !== this.shown.moves) {
      this.shown.moves = state.movesLeft;
      movesEl.querySelector('.value')!.textContent = String(state.movesLeft);
    }
    movesEl.classList.toggle('low', state.status === 'playing' && state.movesLeft > 0 && state.movesLeft <= 3);
    movesEl.classList.toggle('won', state.status === 'won');
    this.hud.querySelector('.hud-goals')!.classList.toggle('won', state.status === 'won');
    def.objectives.forEach((o, k) => {
      const left = Math.max(0, o.target - state.progress[k]);
      if (left === this.shown.progress[k]) return;
      const bump = this.shown.progress[k] >= 0;
      this.shown.progress[k] = left;
      const goal = this.hud.querySelector<HTMLElement>(`.goal[data-k="${k}"]`)!;
      const b = goal.querySelector('b')!;
      b.textContent = left === 0 ? '✓' : String(left);
      goal.classList.toggle('done', left === 0);
      if (bump) {
        b.classList.remove('bump');
        void b.offsetWidth;
        b.classList.add('bump');
      }
    });
    if (state.score !== this.shown.score) {
      this.shown.score = state.score;
      this.hud.querySelector('.score')!.textContent = String(state.score);
      // The bar spans to the 3-star score; marks sit at 0 (the win) and the 2- and 3-star scores.
      const top = Math.max(1, def.stars[2] * 1.05);
      this.hud.querySelector<HTMLElement>('.fill')!.style.clipPath = `inset(0 ${100 - Math.min(100, (state.score / top) * 100)}% 0 0 round 99px)`;
      this.hud.querySelectorAll<HTMLElement>('.mark').forEach((mark) => {
        const k = Number(mark.dataset.k);
        mark.style.left = `${k === 0 ? 0 : (def.stars[k] / top) * 100}%`;
      });
    }
    this.hud.querySelectorAll<HTMLElement>('.mark').forEach((mark) => {
      const k = Number(mark.dataset.k);
      const earned = k === 0 ? state.status === 'won' : state.score >= def.stars[k] && (state.status === 'won' || state.status === 'playing');
      mark.classList.toggle('earned', earned);
    });
  }

  // ---------- messages ----------

  public praise(cascade: number): void {
    const text = S.praise[Math.min(cascade, S.praise.length - 1)];
    if (text) this.flashText(text);
  }

  public flashText(text: string): void {
    const el = this.praiseEl;
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  public announce(def: LevelDef, fails: number): void {
    if (fails >= 2) this.flashText(S.moreMoves);
    else if (def.kind === LevelKind.Hard) this.flashText(S.hardLevel);
    else this.flashText(S.level(def.number));
  }

  /** A short fade to the background color while `change` swaps what is under it. */
  public async curtain(change: () => void | Promise<void>): Promise<void> {
    this.curtainEl.classList.add('on');
    await wait(200);
    try {
      await change();
    } finally {
      this.curtainEl.classList.remove('on');
    }
  }

  // ---------- bits ----------

  private img(frame: string): string {
    return `<img src="${this.icon(frame)}" alt="">`;
  }

  private goalIcon(o: Objective): string {
    switch (o.kind) {
      case ObjectiveKind.Score:
        return '<span class="score-icon">★</span>';
      case ObjectiveKind.Collect:
        return this.img(FrameName.gem(o.color, Special.None));
      case ObjectiveKind.Ice:
        return this.img(FrameName.ice(1));
      case ObjectiveKind.Crate:
        return this.img(FrameName.crate(1));
    }
  }

  private helpRow(icon: string, text: string): string {
    return `<div class="help-row">${icon}<p>${text}</p></div>`;
  }
}

function goalText(o: Objective, left: number): string {
  switch (o.kind) {
    case ObjectiveKind.Score:
      return S.goal.score(left);
    case ObjectiveKind.Collect:
      return S.goal.collect(left);
    case ObjectiveKind.Ice:
      return S.goal.ice(left);
    case ObjectiveKind.Crate:
      return S.goal.crate(left);
  }
}

/** Flat-top hex polygon points at axial (q, a), radius 1, in figure units. */
function hexPoints(q: number, a: number): string {
  const x = 1.5 * q;
  const y = Math.sqrt(3) * (a + q / 2);
  return Array.from({ length: 6 }, (_, k) => {
    const t = (k * Math.PI) / 3;
    return `${(x + Math.cos(t) * 0.92).toFixed(2)},${(y + Math.sin(t) * 0.92).toFixed(2)}`;
  }).join(' ');
}

/** A radius-2 patch of hexes with the shape's cells lit. */
function figure(on: [number, number][]): string {
  const cells: string[] = [];
  for (let q = -2; q <= 2; q++) {
    for (let a = -2; a <= 2; a++) {
      if (Math.abs(q + a) > 2) continue;
      const lit = on.some(([oq, oa]) => oq === q && oa === a);
      cells.push(`<polygon points="${hexPoints(q, a)}"${lit ? ' class="on"' : ''}/>`);
    }
  }
  return `<svg class="fig" viewBox="-4 -4.6 8 9.2">${cells.join('')}</svg>`;
}

function rotorIcon(): string {
  const arrows = Array.from({ length: 6 }, (_, k) => {
    const t = (k * Math.PI) / 3;
    const x = Math.cos(t) * 15;
    const y = Math.sin(t) * 15;
    return `<circle cx="${(24 + x).toFixed(1)}" cy="${(24 + y).toFixed(1)}" r="4.5" fill="rgba(255,255,255,0.75)"/>`;
  }).join('');
  return `<svg class="fig" viewBox="0 0 48 48"><circle cx="24" cy="24" r="15" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="3" stroke-dasharray="6 4"/>${arrows}<path d="M24 16 l5 3 -5 3z" fill="#fff" transform="rotate(-30 24 24)"/></svg>`;
}

/** The title's rosette: gems of every color around a hexagon, like a kaleidoscope's picture. */
function rosette(ui: Ui): string {
  const gems = Array.from({ length: 6 }, (_, k) => {
    const t = (k * Math.PI) / 3 - Math.PI / 2;
    const x = 75 + Math.cos(t) * 50 - 22;
    const y = 75 + Math.sin(t) * 50 - 22;
    return `<image href="${ui.icon(FrameName.gem(k, Special.None), 88)}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="44" height="44"/>`;
  }).join('');
  return `<svg class="rosette" viewBox="0 0 150 150"><image href="${ui.icon(FrameName.gem(6, Special.Nova), 88)}" x="53" y="53" width="44" height="44"/>${gems}</svg>`;
}

/** The faint six-fold rosette behind the game. */
function mandala(): string {
  const petals = Array.from({ length: 12 }, (_, k) => `<ellipse cx="50" cy="26" rx="7" ry="22" transform="rotate(${k * 30} 50 50)"/>`).join('');
  const rings = [12, 30, 44].map((r) => `<circle cx="50" cy="50" r="${r}"/>`).join('');
  const hex = Array.from({ length: 6 }, (_, k) => `<polygon points="50,6 88,28 88,72 50,94 12,72 12,28" transform="rotate(${k * 10} 50 50)"/>`).join('');
  return `<svg id="mandala" viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="0.4">${petals}${rings}${hex}</svg>`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
