import { type Companion, STAT_NAMES, RARITY_STARS } from './types.js';
import { levelProgress } from './leveling.js';

export type ShareDelta = {
  stat: string;
  points: number;
};

export function renderShareHtml(companion: Companion, message?: string, delta?: ShareDelta): string {
  const stars = RARITY_STARS[companion.rarity];
  const { level, currentXp, neededXp } = levelProgress(companion.xp);
  
  const statsHtml = STAT_NAMES.map(s => {
    const isDelta = delta && delta.stat.toUpperCase() === s;
    const baseValue = isDelta ? Math.max(0, companion.stats[s] - delta.points) : companion.stats[s];
    const displayValue = companion.stats[s];
    
    return `
      <div class="stat-row ${isDelta ? 'has-delta' : ''}">
        <span class="stat-name">${s}</span>
        <div class="bar-bg">
          <div class="bar-fill" style="width: ${baseValue}%"></div>
          ${isDelta ? `<div class="bar-delta" style="width: ${delta.points}%"></div>` : ''}
        </div>
        <div class="stat-value-container">
          ${isDelta ? `<span class="delta-badge">+${delta.points}</span>` : ''}
          <span class="stat-value">${displayValue}</span>
        </div>
      </div>
    `;
  }).join('');

  const bubbleHtml = message ? `
    <div class="bubble-container">
      <div class="bubble">
        ${message}
      </div>
      <div class="bubble-tail"></div>
    </div>
  ` : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=Fira+Code:wght@400;600&display=swap');
    
    :root {
      --bg: #030014;
      --card-bg: rgba(13, 12, 34, 0.95);
      --accent: #00ff00;
      --accent-glow: rgba(0, 255, 0, 0.2);
      --text: #ffffff;
      --dim: #a0a0c0;
      --border: rgba(255, 255, 255, 0.1);
      --surface-highlight: rgba(255, 255, 255, 0.03);
      --delta-color: #00ffff;
    }
    
    body {
      margin: 0;
      padding: 40px;
      background: var(--bg);
      font-family: 'Inter', sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 800px;
    }
    
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 20px;
      width: 460px;
      padding: 30px;
      box-shadow: 0 30px 60px rgba(0,0,0,0.8);
      position: relative;
    }
    
    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .rarity {
      color: var(--accent);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    .species {
      color: var(--dim);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
    }

    /* ROW 1: Sprite + Bubble */
    .row-sprite {
      display: flex;
      justify-content: center;
      align-items: flex-end;
      margin-bottom: 5px;
      position: relative;
      height: 140px;
    }
    .sprite-box pre {
      margin: 0;
      color: var(--accent);
      font-family: 'Fira Code', 'Courier New', monospace;
      font-size: 18px;
      line-height: 1.15;
      text-align: center;
      text-shadow: 0 0 10px var(--accent-glow);
    }
    
    .bubble-container {
      position: absolute;
      top: 5px;
      left: 62%; /* Moved slightly right */
      max-width: 170px;
      z-index: 10;
    }
    .bubble {
      background: rgba(0, 15, 0, 0.9);
      color: var(--accent);
      padding: 12px 16px;
      border-radius: 18px; /* Rounded bubble shape */
      border: 1.5px dashed var(--accent); /* "Broken off" look kept */
      font-family: 'Fira Code', monospace;
      font-size: 11px;
      line-height: 1.4;
      box-shadow: 0 0 10px var(--accent-glow);
    }
    .bubble-tail {
      position: absolute;
      bottom: 12px;
      left: -8px;
      width: 0;
      height: 0;
      border-top: 8px solid transparent;
      border-bottom: 8px solid transparent;
      border-right: 8px solid var(--accent);
    }
    .bubble-tail::after {
      content: '';
      position: absolute;
      top: -8px;
      left: 1.5px;
      border-top: 8px solid transparent;
      border-bottom: 8px solid transparent;
      border-right: 8px solid rgba(0, 15, 0, 1);
    }

    /* ROW 2: Bio */
    .row-bio {
      text-align: center;
      margin-bottom: 25px;
      padding: 15px;
      background: var(--surface-highlight);
      border: 1px solid var(--border);
      border-radius: 16px;
    }
    .name {
      font-size: 24px;
      font-weight: 800;
      margin: 0 0 8px 0;
      color: var(--text);
    }
    .bio {
      font-size: 13px;
      color: var(--dim);
      font-style: italic;
      line-height: 1.4;
    }

    /* ROW 3: Stats */
    .row-stats {
      margin-bottom: 20px;
    }
    .stat-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
    }
    .stat-name {
      width: 80px;
      font-size: 9px;
      font-weight: 800;
      color: var(--dim);
      text-transform: uppercase;
    }
    .bar-bg {
      flex: 1;
      height: 6px;
      background: rgba(255,255,255,0.05);
      border-radius: 3px;
      overflow: hidden;
      display: flex;
    }
    .bar-fill {
      height: 100%;
      background: var(--accent);
    }
    .bar-delta {
      height: 100%;
      background: var(--delta-color);
    }
    .stat-value-container {
      width: 65px;
      display: flex;
      align-items: center;
      gap: 6px;
      justify-content: flex-end;
    }
    .stat-value {
      font-size: 12px;
      font-weight: 700;
      font-family: 'Fira Code', monospace;
      color: var(--text);
    }
    .delta-badge {
      font-size: 9px;
      font-weight: 900;
      color: var(--delta-color);
      background: rgba(0, 255, 255, 0.15);
      padding: 1px 4px;
      border-radius: 3px;
    }

    /* Footer */
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 10px;
      border-top: 1px solid var(--border);
    }
    .level-badge {
      background: var(--accent);
      color: #000;
      padding: 3px 10px;
      border-radius: 6px;
      font-weight: 900;
      font-size: 11px;
    }
    .xp-info {
      color: var(--dim);
      font-size: 11px;
      font-weight: 600;
    }
    .repo-link {
      margin-top: 20px;
      text-align: center;
      font-size: 8px;
      color: var(--dim);
      letter-spacing: 1.5px;
      opacity: 0.4;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="rarity">${stars} ${companion.rarity}</div>
      <div class="species">${companion.species}</div>
    </div>
    
    <div class="row-sprite">
      <div class="sprite-box">
        <pre>RENDER_SPRITE_HERE</pre>
      </div>
      ${bubbleHtml}
    </div>
    
    <div class="row-bio">
      <h1 class="name">${companion.name}</h1>
      <div class="bio">"${companion.personalityBio}"</div>
    </div>
    
    <div class="row-stats">
      ${statsHtml}
    </div>
    
    <div class="footer">
      <div class="level-badge">LEVEL ${level}</div>
      <div class="xp-info">${currentXp} / ${neededXp} XP</div>
    </div>
    
    <div class="repo-link">GITHUB.COM/FIORASTUDIO/BUDDY</div>
  </div>
</body>
</html>
  `;
}
