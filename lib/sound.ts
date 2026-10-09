// Sound manager: plays your voice clips with Web Audio for zero-lag playback,
// plus a tiny synthesized "ding" for coins.

export type ClipName = "jump" | "left" | "right" | "down_arrow" | "hit" | "when_game_start" | "long_run_for_while";

/** A clip's file, or a list of files to try in order (first one the browser can decode wins). */
export type ClipSource = string | string[];

/**
 * Default files, served from /public/sounds. Each .m4a is your original
 * recording; the .mp3 copy with the same name is a fallback for browsers
 * that can't decode AAC (e.g. Firefox on some Linux setups).
 */
export const DEFAULT_SOUNDS: Record<ClipName, ClipSource> = {
  jump: "/sounds/jump.mp3",
  left: ["/sounds/left.m4a", "/sounds/left.mp3"],
  right: ["/sounds/right.m4a", "/sounds/right.mp3"],
  down_arrow: ["/sounds/down_arrow.m4a", "/sounds/down_arrow.mp3"],
  hit: ["/sounds/hit.m4a", "/sounds/hit.mp3"],
  when_game_start: ["/sounds/when_game_start.m4a", "/sounds/when_game_start.mp3"],
  long_run_for_while: ["/sounds/long_run_for_while.m4a", "/sounds/long_run_for_while.mp3"],
};

export class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<ClipName, AudioBuffer>();
  private fallbacks = new Map<ClipName, HTMLAudioElement>();
  private current: AudioBufferSourceNode | null = null;
  private currentEl: HTMLAudioElement | null = null;
  muted = false;

  constructor(private urls: Record<ClipName, ClipSource>) {}

  /** Create the audio context and decode every clip. Safe to call many times. */
  async load() {
    if (typeof window === "undefined" || this.ctx) return;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    await Promise.all(
      (Object.keys(this.urls) as ClipName[]).map(async (name) => {
        const list = ([] as string[]).concat(this.urls[name]);
        if (this.ctx) {
          for (const url of list) {
            try {
              const res = await fetch(url);
              if (!res.ok) continue;
              const data = await res.arrayBuffer();
              this.buffers.set(name, await this.ctx.decodeAudioData(data));
              return;
            } catch {
              /* codec not supported here, try the next file */
            }
          }
        }
        // no Web Audio: fall back to a plain <audio> element with the first playable file
        const probe = document.createElement("audio");
        const ext = (u: string) => (u.split("?")[0].endsWith(".m4a") ? "audio/mp4" : "audio/mpeg");
        const url = list.find((u) => u.startsWith("data:") || probe.canPlayType(ext(u))) ?? list[0];
        this.fallbacks.set(name, new Audio(url));
      }),
    );
  }

  /** Browsers only allow audio after a user gesture — call this from key/tap handlers. */
  unlock() {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m) this.stop();
  }

  /** Stop whichever clip is currently playing. */
  stop() {
    if (this.current) {
      try {
        this.current.stop();
      } catch {
        /* already stopped */
      }
      this.current = null;
    }
    if (this.currentEl) {
      this.currentEl.pause();
      this.currentEl = null;
    }
  }

  /**
   * Play a clip from the start. Clips share one "voice" channel: a new clip
   * cuts off the previous one, so quick key presses never pile up into noise.
   */
  play(name: ClipName) {
    if (this.muted) return;
    this.unlock();
    const buf = this.buffers.get(name);
    if (this.ctx && this.master && buf) {
      this.stop();
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.master);
      src.start(0);
      this.current = src;
      src.onended = () => {
        if (this.current === src) this.current = null;
      };
      return;
    }
    const el = this.fallbacks.get(name);
    if (el) {
      this.stop();
      el.currentTime = 0;
      void el.play().catch(() => {});
      this.currentEl = el;
    }
  }

  playCoin() {
    if (this.muted || !this.ctx || !this.master) return;
    const tone = (freq: number, at: number) => {
      const ctx = this.ctx!;
      const t = ctx.currentTime + at;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.04, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      osc.connect(g);
      g.connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.12);
    };
    tone(1320, 0);
    tone(1760, 0.06);
  }
}
