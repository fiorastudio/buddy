# Plaza music (self-hosted, original)

The plaza's 🎵 button plays `plaza-theme.*` from this folder via a hidden
`<audio loop preload="none">` — no YouTube, no visible player, no third-party
request until the visitor opts in.

## Expected files
Drop the exported tracks here (the `<audio>` element in `index.html` references
them, primary first):

- `plaza-theme.ogg` — primary (smaller; Vorbis/Opus)
- `plaza-theme.mp3` — fallback (broad support)

If neither file is present the button no-ops gracefully (nothing plays); the
suite still passes because the opt-in test stubs playback.

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
