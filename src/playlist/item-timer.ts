// One view of one playlist item (spec 2026-09-16-course-progress §2): the
// seconds it was on screen with the tab visible, the seconds the player was
// in state "playing" (visible or not — an audio lecture is listened to with
// the tab hidden), and whether the item reached "done" in that view. The
// session owns one timer; a hide, a jump, an item change or the page
// leaving closes the view, and a return opens a new one for the same item,
// so the teacher's view sums per item. Pure: the clock is injected.

export interface ItemView {
  item: number;
  title: string;
  visible_secs: number;
  playing_secs: number;
  done: boolean;
}

export class ItemTimer {
  private open: { item: number; title: string; done: boolean } | null = null;
  private visible = true;
  private playing = false;
  private visibleMs = 0;
  private playingMs = 0;
  private visibleSince: number | null = null;
  private playingSince: number | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** Open a view. Closes nothing: the caller closes the previous view first. */
  start(item: number, title: string): void {
    this.open = { item, title, done: false };
    this.visibleMs = 0;
    this.playingMs = 0;
    this.visibleSince = this.visible ? this.now() : null;
    this.playingSince = this.playing ? this.now() : null;
  }

  /** The open view's identity, for a return from hidden to restart it. */
  current(): { item: number; title: string } | null {
    return this.open ? { item: this.open.item, title: this.open.title } : null;
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    if (!this.open) return;
    if (v) this.visibleSince = this.now();
    else this.flushVisible();
  }

  setPlaying(p: boolean): void {
    if (p === this.playing) return;
    this.playing = p;
    if (!this.open) return;
    if (p) this.playingSince = this.now();
    else this.flushPlaying();
  }

  markDone(): void {
    if (this.open) this.open.done = true;
  }

  /** Close the open view and return it; null when none is open. */
  close(): ItemView | null {
    if (!this.open) return null;
    this.flushVisible();
    this.flushPlaying();
    const view: ItemView = {
      item: this.open.item,
      title: this.open.title,
      visible_secs: Math.round(this.visibleMs / 1000),
      playing_secs: Math.round(this.playingMs / 1000),
      done: this.open.done,
    };
    this.open = null;
    return view;
  }

  private flushVisible(): void {
    if (this.visibleSince !== null) {
      this.visibleMs += this.now() - this.visibleSince;
      this.visibleSince = null;
    }
  }

  private flushPlaying(): void {
    if (this.playingSince !== null) {
      this.playingMs += this.now() - this.playingSince;
      this.playingSince = null;
    }
  }
}
