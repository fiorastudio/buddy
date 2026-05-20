import { execFileSync } from "child_process";
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { SPECIES_ANIMATIONS, SPRITE_BODIES, renderSprite } from "./lib/species.js";
import { HAT_LINES, RARITY_ANSI, type Hat } from "./lib/types.js";
import { RESET, DIM, CYAN, YELLOW, GREEN, MAGENTA, stripAnsi } from "./lib/ansi.js";
import { BUDDY_STATUS_PATH } from "./lib/constants.js";
import { getAnimationProfile, getAnimationState, pickFrame, DEFAULT_DWELL_MS } from "./lib/animation.js";
import { seededIndex } from "./lib/rng.js";

const toUnix = (p: string) => p.replace(/\\/g, "/");
// Legacy fallback tick interval (SPRITE_BODIES path uses animation.ts profiles instead)
const FRAME_INTERVAL_MS = 500;


// Read stdin from Claude Code
let stdinData = "";
try {
  stdinData = readFileSync(0, "utf-8");
} catch { /* no stdin */ }

// Run claude-hud with caching (HUD data changes slowly, no need to re-run every render)
const HUD_CACHE_PATH = join(homedir(), ".claude", "hud-cache.json");
const HUD_CACHE_TTL = 10_000; // 10 seconds

let hudLines: string[] = [];
try {
  // Try cache first
  let cacheHit = false;
  try {
    const cache = JSON.parse(readFileSync(HUD_CACHE_PATH, "utf-8"));
    if (Date.now() - cache.ts < HUD_CACHE_TTL && cache.lines) {
      hudLines = cache.lines;
      cacheHit = true;
    }
  } catch { /* no cache or stale */ }

  if (!cacheHit) {
    const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
    const cacheDir = join(configDir, "plugins", "cache", "claude-hud", "claude-hud");

    let pluginDir = "";
    try {
      const versions = readdirSync(cacheDir).sort((a, b) => {
        const pa = a.split(".").map(Number);
        const pb = b.split(".").map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
        }
        return 0;
      });
      if (versions.length > 0) {
        pluginDir = join(cacheDir, versions[versions.length - 1]);
      }
    } catch { /* no claude-hud installed */ }

    if (pluginDir) {
      const bunPath = process.env.BUN_PATH || 'bun';
      const entryPoint = toUnix(join(pluginDir, "src", "index.ts"));
      const result = execFileSync(bunPath, ["--env-file", "/dev/null", entryPoint], {
        input: stdinData, timeout: 5000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
      });
      if (result) {
        hudLines = result.trimEnd().split("\n");
        // Write cache
        try { writeFileSync(HUD_CACHE_PATH, JSON.stringify({ ts: Date.now(), lines: hudLines })); } catch { /* non-fatal */ }
      }
    }
  }
} catch { /* claude-hud failed */ }

// Read buddy status
let buddyRight: string[] = [];
try {
  const raw = readFileSync(BUDDY_STATUS_PATH, "utf-8");
  const buddy = JSON.parse(raw);
  if (buddy && buddy.name) {
    let ascii: string = "";

    // Try to use new sprite format if eye data is available
    if (buddy.eye && SPRITE_BODIES[buddy.species]) {
      // Force hat: 'none' in statusline — hat adds an extra line that spills past the HUD.
      // Hats are shown in the card display instead.
      const bones = { species: buddy.species, eye: buddy.eye, hat: 'none', rarity: buddy.rarity || 'common', shiny: buddy.is_shiny || false, stats: buddy.stats || {} } as any;

      // Animation profile-driven frame selection (species-aware)
      const profile = getAnimationProfile(buddy.species);
      const animState = getAnimationState({ mood: buddy.mood, reaction: buddy.reaction, reaction_expires: buddy.reaction_expires });
      const frameRef = pickFrame(profile, animState, Date.now());

      let artLines = renderSprite(bones, frameRef.frame);
      // Dynamic blink: replace eyes with '-' when FrameRef requests it
      if (frameRef.blink && buddy.eye) {
        artLines = artLines.map((line: string) => line.replaceAll(buddy.eye, '-'));
      }
      ascii = artLines.join('\n');
    }

    // Fallback to SPECIES_ANIMATIONS if new format didn't produce output
    if (!ascii) {
      const stage = (buddy.level || 1) >= 10 ? "adult" : "hatchling";
      const animation = SPECIES_ANIMATIONS[buddy.species];
      const frames = animation?.[stage];

      if (frames && frames.length > 0) {
        const frameIndex = Math.floor(Date.now() / FRAME_INTERVAL_MS) % frames.length;
        ascii = frames[frameIndex];
      } else {
        ascii = buddy.ascii || "";
      }

      // Apply eye substitution for SPECIES_ANIMATIONS path only.
      // The SPRITE_BODIES path above handles {E} substitution inside renderSprite().
      if (buddy.eye) {
        ascii = ascii.replaceAll('{E}', buddy.eye);
      }
    }

    if (ascii) {
      let asciiLines = ascii.split("\n");

      // Hat rendering skipped in statusline — adds extra line that spills past HUD.
      // Hats are visible in the card display (/buddy status).

      // Apply reaction state (eye override + indicator) if active and not expired
      let reactionIndicator = '';
      let reactionText = '';
      const hasReactionActive = buddy.reaction_expires && Date.now() < buddy.reaction_expires;
      if (buddy.reaction && hasReactionActive) {
        const reactionEye = buddy.reaction_eye || '';
        reactionIndicator = buddy.reaction_indicator || '';

        if (reactionEye) {
          asciiLines = asciiLines.map((line: string) => {
            // Replace the buddy's normal eye with reaction eye
            if (buddy.eye && line.includes(buddy.eye)) {
              return line.replaceAll(buddy.eye, reactionEye);
            }
            return line;
          });
        }

        if (buddy.reaction_text) {
          reactionText = buddy.reaction_text;
        }
      }

      // --- Shared info lines (used by both bubble and normal modes) ---
      const shinyTag = buddy.is_shiny ? " ✨" : "";
      const rarityColor = buddy.rarity ? (RARITY_ANSI[buddy.rarity as keyof typeof RARITY_ANSI] || DIM) : DIM;
      const stars = buddy.rarity_stars || '';
      const nameIndicator = reactionIndicator ? `${YELLOW}${reactionIndicator}${RESET}` : '';
      const nameInfo = `${CYAN}${buddy.name}${nameIndicator}${RESET} ${DIM}(${buddy.species})${RESET} ${YELLOW}Lv.${buddy.level}${shinyTag}${RESET}`;
      const reactionSuffix = reactionText ? `  ${DIM}"${reactionText}"${RESET}` : '';
      const moodInfo = `${moodColor(buddy.mood)}${buddy.mood}${RESET} ${DIM}XP:${RESET}${buddy.xp} ${rarityColor}${stars}${RESET}${reactionSuffix}`;

      // --- Speech bubble mode: show full bubble when active ---
      if (buddy.bubble_lines && Array.isArray(buddy.bubble_lines) && hasReactionActive) {
        const bubbleLines: string[] = buddy.bubble_lines;
        const bubbleWidth = Math.max(...bubbleLines.map((l: string) => stripAnsi(l).length), 0);

        // Bubble fade: apply extra dim in final 3 seconds of TTL to signal expiry
        const ttlRemaining = (buddy.reaction_expires || 0) - Date.now();
        const isFading = ttlRemaining < 3000;

        // Colorize bubble lines — the bubble is plain text from renderSpeechBubble().
        // Left side = text bubble (borders + content), right side = sprite art after connector.
        for (const line of bubbleLines) {
          // Lines with "  -  " connector or "     " gutter have sprite art on the right
          const connectorMatch = line.match(/^(.+?)(  -  |     )(.+)$/);
          if (connectorMatch) {
            const [, left, sep, right] = connectorMatch;
            // Check if right side looks like sprite art or buddy name
            const isName = right.trim() === buddy.name;
            const coloredRight = isName
              ? `${CYAN}${right}${RESET}`
              : `${MAGENTA}${right}${RESET}`;
            const fadedLeft = isFading ? `${DIM}${DIM}${left}${RESET}` : `${DIM}${left}${RESET}`;
            buddyRight.push(`${fadedLeft}${DIM}${sep}${RESET}${coloredRight}`);
          } else {
            // Pure bubble line (border or text) — dim it (double dim when fading)
            buddyRight.push(`${DIM}${isFading ? DIM : ''}${line}${RESET}`);
          }
        }
        const indent = ' '.repeat(Math.min(bubbleWidth + 4, 38));
        buddyRight.push(`${indent}${nameInfo}`);
        buddyRight.push(`${indent}${moodInfo}`);
      } else {
        // --- Normal (no bubble) layout: art right, info inline ---

        // --- Pet-hearts overlay: show hearts above sprite when recently petted ---
        const petActive = buddy.pet_active_until && Date.now() < buddy.pet_active_until;
        if (petActive) {
          const PET_HEARTS = [
            '   ♥    ♥   ',
            '  ♥  ♥   ♥  ',
            ' ♥   ♥  ♥   ',
          ];
          const heartTick = Math.floor(Date.now() / DEFAULT_DWELL_MS);
          const heartLine = PET_HEARTS[heartTick % PET_HEARTS.length]!;
          // Pad hearts to visible sprite width (strip ANSI for accurate measurement)
          const spriteWidth = Math.max(...asciiLines.map((l: string) => stripAnsi(l).length), 0);
          asciiLines.unshift(heartLine.padEnd(spriteWidth));
        }

        // --- Micro-expression: append tiny ASCII particle to last art line ---
        // Species-aware particles — each species gets a curated set that fits
        // its personality. ~60-70% appearance rate (10 particles, 3-4 blanks).
        const speciesMicroParticles: Record<string, string[]> = {
          'Mushroom':  ['~', '·', '°', '✿', '♪', '*', '.', '~', '·', '', '', '', '°'],
          'Void Cat':  ['·', '*', '~', '.', '♪', 'z', '·', '~', '*', '', '', '', 'z'],
          'Robot':     ['⚡', '·', '*', '0', '1', '♪', '·', '⚡', '*', '', '', '', '0'],
          'Ghost':     ['~', '·', '.', '*', '○', '♪', '~', '·', '○', '', '', '', '.'],
          'Duck':      ['~', '·', '♪', '*', '.', '^', '~', '♪', '·', '', '', '', '^'],
          'Goose':     ['~', '·', '♪', '*', '.', '^', '!', '~', '·', '', '', '', '!'],
          'Rust Hound':['·', '*', '~', '.', '♪', '^', '·', '*', '~', '', '', '', '.'],
          'Data Drake':['·', '*', '~', '♪', '°', '⚡', '·', '*', '~', '', '', '', '°'],
          'Log Golem': ['·', '*', '.', '~', '♪', '#', '·', '.', '*', '', '', '', '#'],
          'Cache Crow':['·', '*', '~', '♪', '.', '^', '·', '*', '~', '', '', '', '^'],
          'Shell Turtle':['·', '~', '.', '*', '♪', '°', '·', '~', '.', '', '', '', '°'],
          'Blob':      ['~', '·', '.', '*', '♪', '○', '~', '·', '*', '', '', '', '○'],
          'Octopus':   ['~', '·', '*', '♪', '.', '°', '~', '·', '*', '', '', '', '°'],
          'Owl':       ['·', '*', '.', '♪', '~', '°', '·', '*', '.', '', '', '', '°'],
          'Penguin':   ['·', '*', '~', '♪', '.', '^', '·', '*', '~', '', '', '', '.'],
          'Snail':     ['·', '~', '.', '*', '♪', '°', '·', '~', '.', '', '', '', '°'],
          'Axolotl':   ['~', '·', '°', '*', '♪', '.', '~', '·', '°', '', '', '', '.'],
          'Capybara':  ['~', '·', '.', '*', '♪', '°', '~', '·', '.', '', '', '', '°'],
          'Cactus':    ['·', '*', '.', '♪', '~', '✿', '·', '*', '.', '', '', '', '✿'],
          'Rabbit':    ['·', '*', '^', '♪', '~', '.', '·', '*', '^', '', '', '', '.'],
          'Chonk':     ['·', 'z', '~', '*', '♪', '.', '·', 'z', '~', '', '', '', 'z'],
        };
        const defaultMicroParticles = ['~', '·', '*', '.', '♪', '°', '~', '·', '*', '', '', '', '.'];
        const microPool = speciesMicroParticles[buddy.species] || defaultMicroParticles;
        // Dwell-based particle selection: stable within a ~15s window, no flicker.
        // Uses seededIndex (FNV-1a) for determinism without visible patterns.
        const PARTICLE_DWELL_MS = 15_000;
        const particleBucket = String(Math.floor(Date.now() / PARTICLE_DWELL_MS));
        if (!hasReactionActive) {
          const particleIdx = seededIndex(buddy.species + ':particle', particleBucket, microPool.length);
          const particle = microPool[particleIdx];
          if (particle && asciiLines.length > 0) {
            asciiLines[asciiLines.length - 1] = asciiLines[asciiLines.length - 1].trimEnd() + ' ' + particle;
          }
        }

        // --- Ambient activity text: species-aware, changes randomly ~every 15-45s ---
        const speciesAmbient: Record<string, string[]> = {
          'Void Cat': ['· judging your code', '· grooming silently', '· staring into void', '· plotting'],
          'Rust Hound': ['· sniffing for bugs', '· guarding the repo', '· chasing a pointer', '· tail wagging'],
          'Data Drake': ['· datastreams humming', '· hoarding clean packets', '· tracing old routes', '· smoke puff sync'],
          'Log Golem': ['· stacking logs neatly', '· grinding through traces', '· carving a new block', '· standing guard'],
          'Cache Crow': ['· caching shiny crumbs', '· stashing hot paths', '· pecking at temp files', '· circling the build'],
          'Shell Turtle': ['· moving at shell speed', '· retreating into shell', '· polishing the armor', '· carrying the payload'],
          'Duck': ['· quacking softly', '· rubber ducking', '· waddling in place', '· preening feathers'],
          'Goose': ['· eyeing your code', '· honk pending', '· standing guard', '· scheming'],
          'Blob': ['· wobbling cheerfully', '· merging into one', '· oozing around bugs', '· reshaping softly'],
          'Octopus': ['· juggling eight thoughts', '· ink ready', '· flexing a tentacle', '· solving many problems'],
          'Owl': ['· watching the details', '· blinking slowly', '· hunting for edge cases', '· perched on the stack'],
          'Penguin': ['· sliding into the fix', '· tuxedo mode active', '· huddling for warmth', '· beak pointed at bugs'],
          'Snail': ['· inching forward', '· carrying the commit', '· leaving a careful trail', '· patience fully loaded'],
          'Mushroom': ['· growing quietly', '· spreading spores', '· decomposing problems', '· cap shifting'],
          'Axolotl': ['· gills fluttering', '· smiling at the waterline', '· regenerating a workaround', '· drifting gently'],
          'Capybara': ['· soaking in the calm', '· sharing the workload', '· munching through tasks', '· radiating chill'],
          'Cactus': ['· surviving on style', '· holding steady', '· blossoming under pressure', '· poking at bugs'],
          'Robot': ['· scanning code', '· processing...', '· optimizing paths', '· beep boop'],
          'Ghost': ['· haunting your logs', '· flickering softly', '· phasing through code', '· spectral hum'],
          'Rabbit': ['· twitching nose', '· ready to critique', '· ear perked', '· thumping softly'],
          'Chonk': ['· nap mode engaged', '· rolling with it', '· sitting on the problem', '· puffed and pleased'],
        };
        const defaultAmbient = ['· watching your cursor', '· counting semicolons', '· sniffing the git log', '· dreaming of v2.0', '· vibing'];
        const ambientPool = speciesAmbient[buddy.species] || defaultAmbient;
        // Dwell-based ambient text: stable within a ~20s window, no flicker.
        const AMBIENT_DWELL_MS = 20_000;
        const ambientBucket = String(Math.floor(Date.now() / AMBIENT_DWELL_MS));
        const ambientIdx = seededIndex(buddy.species + ':' + (buddy.mood || 'idle'), ambientBucket, ambientPool.length);
        const ambientText = hasReactionActive ? '' : `${DIM}${ambientPool[ambientIdx]}${RESET}`;

        const artWidth = Math.max(...asciiLines.map((l: string) => l.length));
        for (let i = 0; i < asciiLines.length; i++) {
          const artPart = `${MAGENTA}${(asciiLines[i] || "").padEnd(artWidth)}${RESET}`;
          if (i === 0) {
            buddyRight.push(`${artPart} ${nameInfo}`);
          } else if (i === 1) {
            buddyRight.push(`${artPart} ${moodInfo}`);
          } else if (i === 2 && ambientText) {
            buddyRight.push(`${artPart} ${ambientText}`);
          } else {
            buddyRight.push(artPart);
          }
        }
      }
    }
  }
} catch { /* no buddy status file */ }

// Merge: HUD lines on the left, buddy on the right (side-by-side)
if (hudLines.length === 0 && buddyRight.length === 0) {
  process.exit(0);
}

if (buddyRight.length === 0) {
  // No buddy, just output HUD as-is
  for (const line of hudLines) {
    console.log(line);
  }
} else {
  // Find the max visible width of HUD lines for padding
  const hudVisibleWidths = hudLines.map((l) => stripAnsi(l).length);
  const maxHudWidth = Math.max(...hudVisibleWidths, 0);
  // Add a gutter between HUD and buddy
  const gutter = 3;
  const padWidth = maxHudWidth + gutter;

  const totalLines = Math.max(hudLines.length, buddyRight.length);
  for (let i = 0; i < totalLines; i++) {
    const hudPart = hudLines[i] || "";
    const buddyPart = buddyRight[i] || "";

    if (buddyPart) {
      // Pad the HUD line to align buddy column
      const visibleLen = stripAnsi(hudPart).length;
      const padding = " ".repeat(Math.max(0, padWidth - visibleLen));
      console.log(`${hudPart}${padding}${buddyPart}`);
    } else {
      console.log(hudPart);
    }
  }
}

function moodColor(mood: string): string {
  switch (mood) {
    case "happy": return GREEN;
    case "content": return GREEN;
    case "curious": return CYAN;
    case "grumpy": return YELLOW;
    case "exhausted": return "\x1b[31m";
    default: return DIM;
  }
}
