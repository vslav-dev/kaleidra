import { type Charges, EARN, progress, stock } from '@/app/boosters';
import { Booster } from '@/core/types';
import { S } from '@/ui/strings';
import { Action } from '@/ui/ui';
import type { BoardRect } from '@/view/boardView';

/** The bar's height and its gap to the board: the board keeps this much free under itself. */
export const BOOSTER_FOOTER = 78;

const ACTIONS: Record<Booster, Action> = { [Booster.Star]: Action.Star, [Booster.Meteor]: Action.Meteor };

const STAR_ICON = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <defs>
    <linearGradient id="bt-star-tail" gradientUnits="userSpaceOnUse" x1="20" y1="28" x2="44" y2="6">
      <stop offset="0" stop-color="#fff6d0"/><stop offset="0.45" stop-color="#ffd25e" stop-opacity="0.7"/><stop offset="1" stop-color="#ffb030" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="bt-star-body" cx="0.5" cy="0.55" r="0.55">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.4" stop-color="#fff0b0"/><stop offset="0.8" stop-color="#ffc940"/><stop offset="1" stop-color="#f09a1c"/>
    </radialGradient>
  </defs>
  <path d="M22.4 30.6 17.6 25.4 44 6Z" fill="url(#bt-star-tail)"/>
  <path d="M26.1 34.2 23.9 31.8 42 20Z" fill="url(#bt-star-tail)" opacity="0.75"/>
  <path d="M15.1 25.2 12.9 22.8 27 8Z" fill="url(#bt-star-tail)" opacity="0.75"/>
  <path transform="rotate(-14 17 31)" d="M17 19 20.2 26.6 28.4 27.3 22.1 32.7 24.1 40.7 17 36.4 10 40.7 11.9 32.7 5.6 27.3 13.8 26.6Z" fill="url(#bt-star-body)" stroke="#fff4cf" stroke-width="1" stroke-linejoin="round"/>
</svg>`;

/** A hot rock falling down left, its glowing face leading, flames streaming up right. */
const METEOR_ICON = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <defs>
    <linearGradient id="bt-flame-out" gradientUnits="userSpaceOnUse" x1="16" y1="30" x2="46" y2="3">
      <stop offset="0" stop-color="#ff5a1f"/><stop offset="0.55" stop-color="#ff3d2e" stop-opacity="0.55"/><stop offset="1" stop-color="#c2185b" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bt-flame-in" gradientUnits="userSpaceOnUse" x1="18" y1="30" x2="40" y2="8">
      <stop offset="0" stop-color="#fff1a8"/><stop offset="0.5" stop-color="#ffb347" stop-opacity="0.8"/><stop offset="1" stop-color="#ff7a2a" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="bt-rock" cx="0.3" cy="0.72" r="0.8">
      <stop offset="0" stop-color="#ffc061"/><stop offset="0.3" stop-color="#d4501e"/><stop offset="0.7" stop-color="#57261a"/><stop offset="1" stop-color="#2a130e"/>
    </radialGradient>
  </defs>
  <path d="M8 25C17 13 31 6 46 2 40 14 32 28 23 40Z" fill="url(#bt-flame-out)"/>
  <path d="M12 26C20 16 29 11 40 7 35 16 29 26 22 35Z" fill="url(#bt-flame-in)"/>
  <path d="M28.5 30 25.2 36.1 19.9 40.8 13.4 38 8.3 33.5 8.9 26.7 12.7 20.7 19.6 21.1 25.8 23.5Z" fill="url(#bt-rock)" stroke="#ff9a4a" stroke-width="1" stroke-linejoin="round"/>
  <path class="line" d="M12 27 17 30 15 35M17 30 23 28 24 33" fill="none" stroke="#ffd27a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const ICONS: Record<Booster, string> = { [Booster.Star]: STAR_ICON, [Booster.Meteor]: METEOR_ICON };

/** An arrow rising out of a ring, a spark beside it: something new is waiting. */
const UPDATE_ICON = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="70 25" stroke-linecap="round" transform="rotate(-60 24 24)"/>
  <path d="M24 32V16M17 22.5 24 15.5 31 22.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M38 6l1.4 3.6L43 11l-3.6 1.4L38 16l-1.4-3.6L33 11l3.6-1.4z" fill="#fff"/>
</svg>`;
const POP_MS = 520;
const POP_EASE = 'cubic-bezier(0.2, 1.6, 0.4, 1)';

/**
 * The two booster buttons under the board, at its right edge. Each icon fills with color from below as its
 * charge grows, with no numbers. A ready booster glows; the star shows its stock as pips.
 */
export class BoosterBar {
  private readonly giveUpEl: HTMLElement;
  private readonly updateEl: HTMLElement;

  public constructor(private readonly el: HTMLElement) {
    el.innerHTML =
      `<button class="update-btn" data-action="${Action.Update}" aria-label="${S.update.button}" hidden>${UPDATE_ICON}</button>` +
      `<button class="give-up" data-action="${Action.GiveUp}" hidden>${S.giveUp}</button>` +
      Object.values(Booster)
        .map(
          (b) =>
            `<button class="booster ${b}" data-action="${ACTIONS[b]}" data-booster="${b}" aria-label="${b}">` +
            `<span class="orb"><span class="layer empty">${ICONS[b]}</span><span class="layer fill">${ICONS[b]}</span></span>` +
            `<span class="pips">${b === Booster.Star ? '<i></i>'.repeat(EARN[b].max) : ''}</span></button>`,
        )
        .join('');
    this.giveUpEl = el.querySelector('.give-up')!;
    this.updateEl = el.querySelector('.update-btn')!;
  }

  /** Under the board, as wide as it. */
  public place(rect: BoardRect): void {
    this.el.style.left = `${rect.x}px`;
    this.el.style.top = `${rect.y + rect.height}px`;
    this.el.style.width = `${rect.width}px`;
  }

  public show(charges: Charges): void {
    this.update(charges, null, false);
    this.el.classList.remove('off');
  }

  public hide(): void {
    this.el.classList.add('off');
    this.beckon(false);
  }

  /** Charges, the booster being aimed, and whether boosters can be used right now. */
  public update(charges: Charges, aiming: Booster | null, usable: boolean): void {
    for (const b of Object.values(Booster)) {
      const button = this.el.querySelector<HTMLElement>(`[data-booster="${b}"]`)!;
      const ready = stock(charges, b) > 0;
      const fill = ready ? 1 : progress(charges, b);
      button.querySelector<HTMLElement>('.fill')!.style.clipPath = `inset(${(1 - fill) * 100}% 0 0 0)`;
      button.classList.toggle('ready', ready);
      button.classList.toggle('aiming', aiming === b);
      button.style.opacity = ready && !usable && aiming !== b ? '0.6' : '1';
      button.querySelectorAll('.pips i').forEach((pip, k) => pip.classList.toggle('on', k < stock(charges, b)));
    }
  }

  /** Out of moves with a booster saved: the ready boosters call, and the player may give up instead. */
  public beckon(on: boolean): void {
    this.giveUpEl.hidden = !on;
    this.el.querySelectorAll('.booster.ready').forEach((b) => b.classList.toggle('beckon', on));
    if (!on) this.el.querySelectorAll('.booster').forEach((b) => b.classList.remove('beckon'));
  }

  /** A new version is out: its button appears at the bar's left end, with one pop to catch the eye. */
  public showUpdate(): void {
    if (!this.updateEl.hidden) return;
    this.updateEl.hidden = false;
    this.updateEl.animate([{ transform: 'scale(0)', opacity: 0, easing: POP_EASE }, { transform: 'scale(1)', opacity: 1 }], POP_MS);
  }
}
