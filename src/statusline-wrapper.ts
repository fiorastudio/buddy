import { execFileSync } from "child_process";
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { SPECIES_ANIMATIONS, SPRITE_BODIES, renderSprite } from "./lib/species.js";
import { HAT_LINES, RARITY_ANSI, type Hat } from "./lib/types.js";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const MAGENTA = "\x1b[35m";

const toUnix = (p: string) => p.replace(/\\/g, "/");
const CLAUDE_STATE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const BUDDY_STATUS_PATH = join(CLAUDE_STATE_DIR, "buddy-status.json");
const FRAME_INTERVAL_MS = 800;

// True randomness for animation — each render picks a fresh random value.
// Idle animations SHOULD be unpredictable, like a real creature.

// Strip ANSI codes for width calculation
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// Read stdin from Claude Code
let stdinData = "";
try {
  stdinData = readFileSync(0, "utf-8");
} catch { /* no stdin */ }

// Run claude-hud with caching (HUD data changes slowly, no need to re-run every render)
const HUD_CACHE_PATH = join(CLAUDE_STATE_DIR, "hud-cache.json");
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
    const cacheDir = join(CLAUDE_STATE_DIR, "plugins", "cache", "claude-hud", "claude-hud");

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
      const frames = SPRITE_BODIES[buddy.species];
      const totalFrames = frames.length;
      const hasReaction = buddy.reaction_expires && Date.now() < buddy.reaction_expires;

      // Organic frame selection — pseudo-random, not fixed timer
      // Each render picks a frame based on hashed time + buddy name
      // This makes the buddy feel alive, not mechanical
      let frameIndex: number;
      const r = Math.random();

      if (hasReaction && (buddy.reaction === 'excited' || buddy.reaction === 'impressed')) {
        // Energetic: any frame, biased toward expressive (1-4)
        frameIndex = r < 0.3 ? 0 : Math.floor(r * totalFrames);
      } else if (hasReaction && buddy.reaction === 'concerned') {
        // Worried: mostly blink, sometimes idle
        frameIndex = r < 0.6 ? 1 : 0;
      } else if (hasReaction) {
        // Other reactions: expressive frames
        frameIndex = 1 + Math.floor(r * Math.max(1, totalFrames - 1));
      } else if (buddy.mood === 'grumpy' || buddy.mood === 'muted') {
        // Grumpy: mostly idle, rare blink (~15% chance)
        frameIndex = r < 0.15 ? 1 : 0;
      } else {
        // Normal idle: weighted random
        // 40% idle, 20% blink, 15% expression, 15% wiggle, 10% special
        if (r < 0.40) frameIndex = 0;
        else if (r < 0.60) frameIndex = 1;
        else if (r < 0.75) frameIndex = 2 % totalFrames;
        else if (r < 0.90) frameIndex = 3 % totalFrames;
        else frameIndex = (totalFrames - 1) % totalFrames;
      }

      const artLines = renderSprite(bones, frameIndex);
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
      if (buddy.reaction && buddy.reaction_expires && Date.now() < buddy.reaction_expires) {
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

      // --- Micro-expression: append tiny ASCII particle to last art line ---
      const hasReactionActive = buddy.reaction_expires && Date.now() < buddy.reaction_expires;
      const microR = Math.random();
      const microParticles = ['', '', '~', '', '*', '', '.', '♪', '', 'z', '·', ''];
      if (!hasReactionActive) {
        const particle = microParticles[Math.floor(microR * microParticles.length)];
        if (particle && asciiLines.length > 0) {
          asciiLines[asciiLines.length - 1] = asciiLines[asciiLines.length - 1].trimEnd() + ' ' + particle;
        }
      }

      // --- Ambient activity text: species-aware, changes randomly ~every 15-45s ---
      const speciesAmbient: Record<string, string[]> = {
        'Void Cat': ['· judging your code', '· grooming silently', '· staring into void', '· plotting'],
        'Rust Hound': ['· sniffing for bugs', '· guarding the repo', '· chasing a pointer', '· tail wagging'],
        'Duck': ['· quacking softly', '· rubber ducking', '· waddling in place', '· preening feathers'],
        'Goose': ['· eyeing your code', '· honk pending', '· standing guard', '· scheming'],
        'Mushroom': ['· growing quietly', '· spreading spores', '· decomposing problems', '· cap shifting'],
        'Robot': ['· scanning code', '· processing...', '· optimizing paths', '· beep boop'],
        'Ghost': ['· haunting your logs', '· flickering softly', '· phasing through code', '· spectral hum'],
        'Rabbit': ['· twitching nose', '· ready to critique', '· ear perked', '· thumping softly'],
      };
      const defaultAmbient = ['· watching your cursor', '· counting semicolons', '· sniffing the git log', '· dreaming of v2.0', '· vibing'];
      const ambientPool = speciesAmbient[buddy.species] || defaultAmbient;
      const ambientR = Math.random();
      const ambientText = hasReactionActive ? '' : `${DIM}${ambientPool[Math.floor(ambientR * ambientPool.length)]}${RESET}`;

      const shinyTag = buddy.is_shiny ? " ✨" : "";
      const rarityColor = buddy.rarity ? (RARITY_ANSI[buddy.rarity as keyof typeof RARITY_ANSI] || DIM) : DIM;
      const stars = buddy.rarity_stars || '';
      const nameIndicator = reactionIndicator ? `${YELLOW}${reactionIndicator}${RESET}` : '';
      const nameInfo = `${CYAN}${buddy.name}${nameIndicator}${RESET} ${DIM}(${buddy.species})${RESET} ${YELLOW}Lv.${buddy.level}${shinyTag}${RESET}`;
      const reactionSuffix = reactionText ? `  ${DIM}"${reactionText}"${RESET}` : '';
      const moodInfo = `${moodColor(buddy.mood)}${buddy.mood}${RESET} ${DIM}XP:${RESET}${buddy.xp} ${rarityColor}${stars}${RESET}${reactionSuffix}`;

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
