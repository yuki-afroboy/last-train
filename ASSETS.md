# ASSETS

## Summary

**This project ships zero binary assets.** There are no `.glb`, `.png`, `.jpg`,
`.hdr`, `.mp3`, `.ogg` or `.wav` files in the repository or in the production
build. Everything you see and hear is generated at runtime in the browser.

That is a deliberate choice rather than a limitation:

- no third-party licence obligations to track or get wrong,
- no asset can 404 after deployment — a whole class of "works on localhost only"
  bugs simply cannot occur,
- the first download stays small (~185 KB gzipped total), which matters most on
  mobile data,
- anomalies can regenerate a sign, a poster or a vending-machine front with one
  character changed, at runtime, with no loading hitch.

## Textures

All textures are drawn to a `<canvas>` at load time by
[`src/gfx/Textures.ts`](src/gfx/Textures.ts) and uploaded as `CanvasTexture`.
Roughness maps are painted directly; normal maps are derived from generated
height fields with a Sobel filter (`heightToNormal`).

| Generator | Used for |
| --- | --- |
| `concreteDeck` | platform deck (albedo + roughness + normal) |
| `tactilePaving` | 点字ブロック warning strip |
| `wallTile` | platform back wall panels |
| `ballast` | track bed crushed stone |
| `wetAsphalt` | ground beyond the station, with puddle roughness |
| `paintedMetal` | vending machines, bins, lamp housings, pillars |
| `stationSign` | 駅名標 (regenerated when an anomaly renames a station) |
| `exitSign` | 出口 sign above the stairs — also the progress counter |
| `poster` | rules board, notices, safety poster, adverts |
| `clockFace` | analogue platform clock dial |
| `vendingFront` | vending machine product display |
| `departureBoard` | LED departure indicator |
| `labelPlate` | pillar numbers, small signage |
| `distantTown` | town silhouette on the horizon |
| `rainStreak`, `glowSprite` | particle sprites |

## Environment map

`src/gfx/Environment.ts` paints an equirectangular night sky (overcast cloud
base lit from below by sodium street light) onto a 512×256 canvas and runs it
through `THREE.PMREMGenerator`. This is what gives metals and wet surfaces
something to reflect.

## Audio

All sound is synthesised into `AudioBuffer`s at first user gesture by
[`src/audio/AudioSystem.ts`](src/audio/AudioSystem.ts) using hand-written
DSP (filtered noise, one-pole and state-variable filters, additive synthesis):

rain · rain on the roof · fluorescent ballast hum · vending-machine compressor ·
wind · four footstep variants on concrete and four on metal stairs · a distant
train · a train passing close · thunder · the station chime · a muffled PA
voice · structural metal creaks · rail expansion ticks · UI clicks · the
correct/incorrect stings · a sub-bass unease bed.

Positional sources (lamp hum, vending compressor, phantom footsteps) use
`THREE.PositionalAudio` so distance and head orientation are handled by the
Web Audio panner.

## Fonts

The UI and every canvas texture use the platform's own Japanese system fonts via
a font stack (`Hiragino Kaku Gothic ProN`, `Yu Gothic`, `Noto Sans JP`,
`Meiryo`, …). No webfont is downloaded.

## Third-party code

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| [three](https://github.com/mrdoob/three.js) | ^0.185 | MIT | renderer, post-processing, positional audio |
| [vite](https://vitejs.dev) | ^8 | MIT | dev server & production build (build-time only) |
| [typescript](https://www.typescriptlang.org) | ^5.9 | Apache-2.0 | types (build-time only) |
| [playwright](https://playwright.dev) | ^1.62 | Apache-2.0 | headless QA scripts (dev only) |
| [pngjs](https://github.com/pngjs/pngjs) | ^7 | MIT | screenshot luminance metrics (dev only) |

Nothing beyond `three` is shipped to the browser.
