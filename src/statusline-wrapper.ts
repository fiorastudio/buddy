import { execSync } from "child_process";
import { readFileSync, readdirSync } from "fs";
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
const BUDDY_STATUS_PATH = join(homedir(), ".claude", "buddy-status.json");
const FRAME_INTERVAL_MS = 2000;

// Strip ANSI codes for width calculation
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// Read stdin from Claude Code
let stdinData = "";
try {
  stdinData = readFileSync(0, "utf-8");
} catch { /* no stdin */ }

// Run claude-hud and capture output (don't print yet)
let hudLines: string[] = [];
try {
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
    const result = execSync(
      `"${bunPath}" --env-file /dev/null "${entryPoint}"`,
      { input: stdinData, timeout: 5000, encoding: "utf-8", shell: "bash", stdio: ["pipe", "pipe", "pipe"] }
    );
    if (result) {
      hudLines = result.trimEnd().split("\n");
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
      const bones = { species: buddy.species, eye: buddy.eye, hat: buddy.hat || 'none', rarity: buddy.rarity || 'common', shiny: buddy.is_shiny || false, stats: buddy.stats || {} } as any;
      const frames = SPRITE_BODIES[buddy.species];
      const frameIndex = Math.floor(Date.now() / FRAME_INTERVAL_MS) % frames.length;
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

      // Apply hat overlay on first line if hat is provided and line is blank
      if (buddy.hat && buddy.hat !== 'none' && asciiLines.length > 0 && !asciiLines[0].trim()) {
        const hatLine = HAT_LINES[buddy.hat as Hat];
        if (hatLine) {
          asciiLines[0] = hatLine;
        }
      }

      // Apply reaction state (eye override + indicator) if active and not expired
      let reactionIndicator = '';
      let reactionText = '';
      if (buddy.reaction && buddy.reaction_expires && Date.now() < buddy.reaction_expires) {
        reactionIndicator = buddy.reaction === 'impressed' ? '!'
          : buddy.reaction === 'concerned' ? '?'
          : buddy.reaction === 'amused' ? '~'
          : buddy.reaction === 'excited' ? '!!'
          : buddy.reaction === 'thinking' ? '...'
          : '';

        // Override eyes in art based on reaction state
        const reactionEye = buddy.reaction === 'impressed' ? '✦'
          : buddy.reaction === 'concerned' ? '×'
          : buddy.reaction === 'amused' ? '°'
          : buddy.reaction === 'excited' ? '◉'
          : buddy.reaction === 'thinking' ? '·'
          : '';

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
