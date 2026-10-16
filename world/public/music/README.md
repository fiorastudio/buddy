# Plaza music (self-hosted, original)

Music is **opt-in**. Nothing plays, and no track is fetched, until the visitor
presses the plaza's 🎵 button; pressing it again stops it. Tapping the plaza or
pressing a key never starts it. It plays from this folder via a hidden
`<audio loop preload="none">`: no YouTube, no visible player, no third-party
request.

## Expected files
Each town has its own theme. Drop the exported tracks here, `.ogg` (primary,
smaller; Vorbis/Opus) and `.mp3` (fallback, broad support) for each:

| Town (district) | Track |
| --- | --- |
| Prontera (`plaza-1`) | `plaza-theme` (referenced directly by the `<audio>` in `index.html`) |
| Payon (`plaza-2`) | `payon` |
| Geffen (`plaza-3`) | `geffen` |
| Alberta (`plaza-4`) | `alberta` |
| Morroc (`plaza-5`) | `morroc` |
| Comodo (`plaza-6`) | `comodo` |

`plaza.js` (`TOWN_TRACK`) swaps in the current town's track the first time the
button is pressed, so opening a page never fetches audio.

If a town's files are missing, the button does nothing (nothing plays). The
suite still passes, because the music tests stub playback.

## How the tracks are made (copyright-safe)
**Original, AI-generated instrumental music** (Suno), described by *genre / mood /
instrumentation only*. Musical style is not copyrightable — specific melodies and
recordings are — so these evoke the *feeling* of a cozy MMO town without copying
any existing composition. Do **not** reference Ragnarok Online or any track title
in the prompt, and do **not** ingest/reshape an existing recording (that would be
an infringing derivative).

### Suno prompt — main plaza theme (instrumental)
> cozy fantasy MMORPG town theme, nostalgic and warm, mid-tempo new-age
> orchestral, soft piano melody, warm string pads, light pizzicato, delicate
> flute and harp, gentle bell accents, soft mallet percussion, peaceful bustling
> town square at midday, bittersweet and comforting, instrumental, seamless
> loop, ~80 BPM, major key

### Optional variants (future)
- **Dusk/quiet:** calm ambient fantasy town at dusk, slow and dreamy, sparse soft
  piano, warm pads, acoustic guitar harmonics, airy flute, distant wind chimes,
  soft reverb, instrumental, seamless loop, ~65 BPM.
- **Celebration stinger:** short triumphant fantasy fanfare, bright bells, harp
  glissando, warm brass swell, sparkly chimes, ~4s, instrumental.

Generate a few times, pick the best take, export MP3 (add an OGG/Opus for size),
name them as above.
