"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CHARACTERS, Engine, type Action } from "@/lib/engine";
import { DEFAULT_SOUNDS, SoundManager, type ClipName, type ClipSource } from "@/lib/sound";

type Phase = "ready" | "running" | "paused" | "over";

const BEST_KEY = "balle-balle-runner-best";

function readBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeBest(v: number) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* storage unavailable */
  }
}

export default function Game({ sounds }: { sounds?: Partial<Record<ClipName, ClipSource>> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const soundRef = useRef<SoundManager | null>(null);
  const phaseRef = useRef<Phase>("ready");
  const touchRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const overAtRef = useRef(0);

  const [phase, setPhaseState] = useState<Phase>("ready");
  const [score, setScore] = useState(0);
  const [coins, setCoins] = useState(0);
  const [best, setBest] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [muted, setMuted] = useState(false);
  const [charIdx, setCharIdx] = useState(0);
  const [jumpFlash, setJumpFlash] = useState(0);

  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };

  // boot engine + sound once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBest(readBest());

    const sound = new SoundManager({ ...DEFAULT_SOUNDS, ...sounds });
    soundRef.current = sound;
    void sound.load();

    const engine = new Engine(canvas, {
      onJump: () => {
        sound.play("jump");
        setJumpFlash((n) => n + 1);
      },
      onCoin: () => sound.playCoin(),
      onCrash: () => sound.play("hit"),
      onStumble: () => sound.play("hit"),
      onLeft: () => sound.play("left"),
      onRight: () => sound.play("right"),
      onRoll: () => sound.play("down_arrow"),
      onLongRun: () => sound.play("long_run_for_while"),
      onHud: (s, c) => {
        setScore(s);
        setCoins(c);
      },
      onGameOver: (s) => {
        const prev = readBest();
        if (s > prev) {
          writeBest(s);
          setBest(s);
          setNewBest(true);
        } else setNewBest(false);
        overAtRef.current = performance.now();
        setPhase("over");
      },
    });
    engineRef.current = engine;

    const onResize = () => engine.resize();
    window.addEventListener("resize", onResize);
    const onHide = () => {
      if (document.hidden && engine.state === "running") {
        engine.togglePause();
        setPhase("paused");
      }
    };
    document.addEventListener("visibilitychange", onHide);

    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onHide);
      engine.destroy();
      sound.stop();
    };
    // sounds is read once at boot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setLook(CHARACTERS[charIdx]);
  }, [charIdx]);

  const startGame = useCallback(() => {
    soundRef.current?.unlock();
    engineRef.current?.start();
    soundRef.current?.play("when_game_start");
    setNewBest(false);
    setScore(0);
    setCoins(0);
    setPhase("running");
  }, []);

  const togglePause = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    e.togglePause();
    if (e.state === "paused") setPhase("paused");
    else if (e.state === "running") setPhase("running");
  }, []);

  const act = useCallback((a: Action) => {
    soundRef.current?.unlock();
    engineRef.current?.input(a);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      soundRef.current?.setMuted(!m);
      return !m;
    });
  }, []);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      const p = phaseRef.current;
      const gameKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "];
      if (gameKeys.includes(k)) e.preventDefault();

      if (k === "m" || k === "M") return toggleMute();

      if (p === "ready" || p === "over") {
        if (p === "ready" && (k === "ArrowLeft" || k === "ArrowRight")) {
          setCharIdx((i) => (i + (k === "ArrowLeft" ? CHARACTERS.length - 1 : 1)) % CHARACTERS.length);
          return;
        }
        if (k === "Enter" || k === " " || k === "ArrowUp") {
          // small guard so a held/mashed key doesn't instantly restart after a crash
          if (e.repeat || performance.now() - overAtRef.current < 500) return;
          startGame();
        }
        return;
      }
      if (k === "p" || k === "P" || k === "Escape") return togglePause();
      if (p === "paused") {
        if (k === " " || k === "Enter") togglePause();
        return;
      }
      switch (k) {
        case "ArrowLeft":
        case "a":
        case "A":
          act("left");
          break;
        case "ArrowRight":
        case "d":
        case "D":
          act("right");
          break;
        case "ArrowUp":
        case "w":
        case "W":
        case " ":
          if (!e.repeat) act("jump");
          break;
        case "ArrowDown":
        case "s":
        case "S":
          act("roll");
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, startGame, togglePause, toggleMute]);

  // touch swipes
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, t: performance.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touchRef.current;
    touchRef.current = null;
    if (!s || phaseRef.current !== "running") return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return act("jump"); // tap = jump
    if (Math.abs(dx) > Math.abs(dy)) act(dx > 0 ? "right" : "left");
    else act(dy < 0 ? "jump" : "roll");
  };

  const look = CHARACTERS[charIdx];

  return (
    <div className="stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <canvas ref={canvasRef} className="canvas" />

      {phase !== "ready" && (
        <div className="hud">
          <div className="pill score">
            <span className="label">Score</span>
            <span className="value">{score.toLocaleString()}</span>
          </div>
          <div className="hud-right">
            <div className="pill coins">
              <span className="coin-icon">₹</span>
              <span className="value">{coins}</span>
            </div>
            <button className="icon-btn" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
              {muted ? "🔇" : "🔊"}
            </button>
            {(phase === "running" || phase === "paused") && (
              <button className="icon-btn" onClick={togglePause} aria-label="Pause">
                {phase === "paused" ? "▶" : "❚❚"}
              </button>
            )}
          </div>
        </div>
      )}

      {phase === "running" && jumpFlash > 0 && (
        <div key={jumpFlash} className="balle">
          Balle!
        </div>
      )}

      {phase === "ready" && (
        <div className="overlay">
          <div className="card">
            <div className="kicker">ਚੱਕ ਦੇ ਫੱਟੇ · Chak De Phatte</div>
            <h1 className="title">
              Balle Balle
              <br />
              <span>Runner</span>
            </h1>
            <p className="sub">Dodge the tractors, leap the hay bales, roll under the phulkari — and collect every rupee on the road through Punjab.</p>

            <div className="chars" role="radiogroup" aria-label="Choose your runner">
              {CHARACTERS.map((c, i) => (
                <button
                  key={c.name}
                  role="radio"
                  aria-checked={i === charIdx}
                  className={`char ${i === charIdx ? "active" : ""}`}
                  onClick={() => setCharIdx(i)}
                >
                  <span className="swatch">
                    <span className="sw-turban" style={{ background: c.turban }} />
                    <span className="sw-face" style={{ background: c.skin }} />
                    <span className="sw-kurta" style={{ background: c.kurta }} />
                  </span>
                  {c.name}
                </button>
              ))}
            </div>

            <button className="play" onClick={startGame}>
              Play as {look.name}
            </button>
            <div className="keys">
              <span><kbd>↑</kbd> Jump</span>
              <span><kbd>←</kbd><kbd>→</kbd> Switch lane</span>
              <span><kbd>↓</kbd> Roll</span>
              <span><kbd>P</kbd> Pause</span>
              <span><kbd>M</kbd> Mute</span>
            </div>
            <div className="hint">On a phone: swipe up / left / right / down</div>
            {best > 0 && <div className="best">Best: {best.toLocaleString()}</div>}
          </div>
        </div>
      )}

      {phase === "paused" && (
        <div className="overlay">
          <div className="card small">
            <h2 className="title-sm">Paused</h2>
            <button className="play" onClick={togglePause}>
              Resume
            </button>
            <div className="hint">Press P, Esc or Space</div>
          </div>
        </div>
      )}

      {phase === "over" && (
        <div className="overlay">
          <div className="card small">
            <div className="kicker">Oh teri!</div>
            <h2 className="title-sm">Game Over</h2>
            {newBest && <div className="new-best">New best score!</div>}
            <div className="stats">
              <div>
                <span className="label">Score</span>
                <span className="value">{score.toLocaleString()}</span>
              </div>
              <div>
                <span className="label">Rupees</span>
                <span className="value">₹{coins}</span>
              </div>
              <div>
                <span className="label">Best</span>
                <span className="value">{best.toLocaleString()}</span>
              </div>
            </div>
            <button className="play" onClick={startGame}>
              Run again
            </button>
            <div className="hint">Press Enter or ↑</div>
          </div>
        </div>
      )}
    </div>
  );
}
