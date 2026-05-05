import { type Companion, STAT_NAMES, RARITY_STARS } from './types.js';
import { levelProgress } from './leveling.js';

export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export const SPRITE_PLACEHOLDER = 'BUDDY_SPRITE_7f3a9';

export function renderShareHtml(companion: Companion): string {
  const stars = RARITY_STARS[companion.rarity];
  const { level, currentXp, neededXp } = levelProgress(companion.xp);
  const xpPercent = Math.min(100, Math.floor((currentXp / neededXp) * 100));

  const statsHtml = STAT_NAMES.map(s => {
    const val = companion.stats[s] ?? 0;
    return `
    <div class="stat-row">
      <span class="stat-name">${s}</span>
      <div class="bar-bg">
        <div class="bar-fill" style="width: ${val}%"></div>
      </div>
      <span class="stat-value">${val}</span>
    </div>
  `}).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    :root {
      --bg: #0f0c29;
      --card-bg: rgba(20, 20, 40, 0.9);
      --accent: #00ff00;
      --text: #ffffff;
      --dim: #888899;
      --border: #333344;
    }
    body {
      margin: 0;
      padding: 40px;
      background: var(--bg);
      font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif, 'monospace', 'sans-serif';
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 500px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 20px;
      width: 500px;
      padding: 30px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.5);
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, transparent, var(--accent), transparent);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
    }
    .rarity {
      color: var(--accent);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    .species {
      color: var(--dim);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .main-area {
      display: flex;
      gap: 30px;
      margin-bottom: 30px;
    }
    .sprite-box {
      width: 140px;
      height: 140px;
      background: rgba(0,0,0,0.3);
      border-radius: 15px;
      display: flex;
      justify-content: center;
      align-items: center;
      border: 1px solid var(--border);
    }
    .sprite-box pre {
      margin: 0;
      color: var(--accent);
      font-family: 'Cascadia Code', 'Fira Code', 'Courier New', Courier, monospace;
      font-size: 16px;
      line-height: 1.2;
    }
    .info-box {
      flex: 1;
    }
    .name {
      font-size: 32px;
      font-weight: 800;
      margin: 0 0 10px 0;
      color: var(--text);
    }
    .bio {
      font-size: 14px;
      color: var(--dim);
      font-style: italic;
      line-height: 1.5;
    }
    .stats-container {
      background: rgba(0,0,0,0.2);
      padding: 20px;
      border-radius: 15px;
      margin-bottom: 20px;
    }
    .stat-row {
      display: flex;
      align-items: center;
      gap: 15px;
      margin-bottom: 12px;
    }
    .stat-row:last-child { margin-bottom: 0; }
    .stat-name {
      width: 90px;
      font-size: 10px;
      font-weight: 700;
      color: var(--dim);
      text-transform: uppercase;
    }
    .bar-bg {
      flex: 1;
      height: 6px;
      background: #222233;
      border-radius: 3px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      background: var(--accent);
      box-shadow: 0 0 10px var(--accent);
    }
    .stat-value {
      width: 30px;
      font-size: 12px;
      font-family: monospace;
      color: var(--accent);
      text-align: right;
    }
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
    }
    .level-badge {
      background: var(--accent);
      color: #000;
      padding: 4px 12px;
      border-radius: 20px;
      font-weight: 800;
    }
    .xp-info {
      color: var(--dim);
    }
    .repo-link {
      margin-top: 20px;
      text-align: center;
      font-size: 10px;
      color: var(--dim);
      letter-spacing: 1px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="rarity">${stars} ${companion.rarity}</div>
      <div class="species">${companion.species}</div>
    </div>
    
    <div class="main-area">
      <div class="sprite-box">
        <pre>${SPRITE_PLACEHOLDER}</pre>
      </div>
      <div class="info-box">
        <h1 class="name">${escapeHtml(companion.name)}</h1>
        <div class="bio">"${escapeHtml(companion.personalityBio)}"</div>
      </div>
    </div>
    
    <div class="stats-container">
      ${statsHtml}
    </div>
    
    <div class="footer">
      <div class="level-badge">LVL ${level}</div>
      <div class="xp-info">${currentXp} / ${neededXp} XP</div>
    </div>
    
    <div class="repo-link">GITHUB.COM/FIORASTUDIO/BUDDY</div>
  </div>
</body>
</html>
  `;
}
