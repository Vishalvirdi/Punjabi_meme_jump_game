# Balle Balle Runner 🏃‍♂️🌾

A Subway-Surfers-style endless runner set on a village road in Punjab, built with **Next.js 15 + TypeScript**.
Your runner wears a pagg (turban), kurta-pajama and juttis, and races past mustard fields, haystacks and a golden gurdwara.

Your own voice clips play during the game. They live in `public/sounds/`:

| File | When it plays |
| --- | --- |
| `jump.mp3` | Jump (↑) |
| `left.m4a` | Move left (←) |
| `right.m4a` | Move right (→) |
| `down_arrow.m4a` | Roll (↓) |
| `hit.m4a` | Crashing into something, or scraping a tractor's side |
| `when_game_start.m4a` | A run starts |
| `long_run_for_while.m4a` | Every 20 seconds you stay alive |

Clips share one channel: a new clip cuts off the one before it, so fast key presses don't stack up into noise.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000.

For a production build: `npm run build && npm start`.

## Controls

| Key | Action |
| --- | --- |
| ↑ / W / Space | Jump (plays the jump sound) |
| ← → / A D | Switch lane |
| ↓ / S | Roll (also slams you down mid-jump) |
| P / Esc | Pause |
| M | Mute |
| Enter | Start / restart |

On phones: swipe up / left / right / down, tap to jump.

## Obstacles

- **Red tractor** – too tall to jump, switch lanes
- **Hay bale** – jump over it
- **Phulkari banner** – roll under it
- **₹ coins** – collect them

Clipping the side of a tractor while changing lanes bounces you back (a stumble); hitting anything head-on ends the run. Speed increases over time. Your best score is saved in the browser.

## Project layout

```
app/
  layout.tsx        page metadata + viewport
  page.tsx          renders <Game />
  globals.css       HUD, menus, game-over screen
components/
  Game.tsx          React wrapper: keyboard/touch input, HUD, menus, high score
lib/
  engine.ts         game loop, physics, collisions, spawning, all canvas drawing
  sound.ts          Web Audio player for all the voice clips (+ a small coin ding)
public/sounds/
  *.mp3 / *.m4a     your uploaded clips
```

## Customising

- **Change a sound:** replace the file in `public/sounds/` (keep the name), or point to a different file with `<Game sounds={{ left: "/sounds/other.mp3" }} />` in `app/page.tsx`. File paths are listed in `DEFAULT_SOUNDS` in `lib/sound.ts`.
- **How often the long-run clip plays:** change `LONG_RUN_EVERY` in `lib/engine.ts`.
- **Add or change characters:** edit the `CHARACTERS` array at the top of `lib/engine.ts` (turban, kurta, pajama and skin colours).
- **Difficulty:** tune `START_SPEED`, `MAX_SPEED`, `JUMP_V` and `GRAVITY` in `lib/engine.ts`.

## Deploy

Push to GitHub and import it on Vercel, or run `npm run build && npm start` on any Node host.
