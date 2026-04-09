import { execSync } from "child_process";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { SPECIES_ANIMATIONS } from "./lib/species.js";

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
    const bunPath = "/c/Users/steven.wu/.bun/bin/bun";
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
    const stage = (buddy.level || 1) >= 10 ? "adult" : "hatchling";
    const animation = SPECIES_ANIMATIONS[buddy.species];
    const frames = animation?.[stage];

    let ascii: string;
    if (frames && frames.length > 0) {
      const frameIndex = Math.floor(Date.now() / FRAME_INTERVAL_MS) % frames.length;
      ascii = frames[frameIndex];
    } else {
      ascii = buddy.ascii || "";
    }

    if (ascii) {
      const asciiLines = ascii.split("\n");
      const shinyTag = buddy.is_shiny ? " ✨" : "";
      const nameInfo = `${CYAN}${buddy.name}${RESET} ${DIM}(${buddy.species})${RESET} ${YELLOW}Lv.${buddy.level}${shinyTag}${RESET}`;
      const moodInfo = `${moodColor(buddy.mood)}${buddy.mood}${RESET} ${DIM}XP:${RESET}${buddy.xp}`;

      // Build right-side column: art lines with info on the first two
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
