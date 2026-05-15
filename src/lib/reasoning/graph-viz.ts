import { writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { exec } from 'child_process';
import { homedir } from 'os';
import Database from 'better-sqlite3';
import { resolveSessionTrace } from './session-trace.js';
import { CAUTION_FINDINGS, KUDOS_FINDINGS } from './types.js';

const DB_PATH = process.env.BUDDY_DB_PATH || join(homedir(), '.buddy', 'buddy.db');

const BASIS_COLORS: Record<string, string> = {
  research: '#2196F3',
  empirical: '#4CAF50',
  deduction: '#9C27B0',
  analogy: '#FF9800',
  definition: '#607D8B',
  llm_output: '#FFC107',
  assumption: '#F44336',
  vibes: '#E91E63',
};

const EDGE_COLORS: Record<string, string> = {
  supports: '#2196F3',
  depends_on: '#9E9E9E',
  contradicts: '#F44336',
  questions: '#FF9800',
};

type StoredClaimRow = {
  id: string;
  session_id: string;
  speaker: string;
  text: string;
  basis: string;
  confidence: string;
  created_at: number;
};

type StoredEdgeRow = {
  id: string;
  session_id: string;
  from_claim: string;
  to_claim: string;
  type: string;
  created_at: number;
};

type FindingLogRow = {
  id: number;
  companion_id: string;
  session_id: string;
  finding_type: string;
  anchor_claim_id: string;
  observe_seq: number;
  created_at: number;
};

function openPath(targetPath: string): Promise<void> {
  const command = process.platform === 'darwin'
    ? `open ${JSON.stringify(targetPath)}`
    : process.platform === 'win32'
      ? `start "" ${JSON.stringify(targetPath)}`
      : `xdg-open ${JSON.stringify(targetPath)}`;

  return new Promise((resolvePromise, rejectPromise) => {
    exec(command, (error) => {
      if (error) rejectPromise(error);
      else resolvePromise();
    });
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseArgs(args: string[]): { sessionId: string | null; outPath: string | null; open: boolean } {
  let sessionId: string | null = null;
  let outPath: string | null = null;
  let open = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--open') {
      open = true;
      continue;
    }
    if (arg === '--out') {
      outPath = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      continue;
    }
    if (!sessionId) sessionId = arg;
  }

  return { sessionId, outPath, open };
}

function buildOutputPath(sessionId: string | null, outPath: string | null): string {
  if (outPath) return resolve(outPath);
  const fileName = sessionId ? `buddy-graph-${sessionId}.html` : 'buddy-graph.html';
  return join(process.cwd(), fileName);
}

function buildProjectLabel(sessionId: string): string {
  const trace = resolveSessionTrace(sessionId);
  if (trace.projectLabel) return trace.projectLabel;
  if (trace.cwdHash) return `${trace.cwdHash.slice(0, 8)}…`;
  return sessionId;
}

function toScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/<\/script>/gi, '<\\/script>');
}

function buildHtml(params: {
  outputPath: string;
  sessions: string[];
  sessionMeta: Array<{ session_id: string; hash: string; date: string; projectName: string }>;
  projects: Array<{ hash: string; name: string }>;
  datesByProject: Record<string, string[]>;
  visNodes: unknown[];
  visEdges: unknown[];
  stats: { claims: number; edges: number; findings: number; sessions: number };
}): string {
  const { outputPath, sessionMeta, projects, datesByProject, visNodes, visEdges, stats } = params;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Buddy Reasoning Graph</title>
  <script src="https://unpkg.com/vis-network@9.1.9/dist/vis-network.min.js"></script>
  <style>
    body { margin: 0; font-family: Inter, system-ui, sans-serif; display: flex; height: 100vh; background: #f6f8fb; color: #111; }
    #sidebar { width: 360px; overflow-y: auto; border-right: 1px solid #dde3ea; background: #fff; padding: 16px; box-sizing: border-box; }
    #graph { flex: 1; min-width: 0; }
    h1 { margin: 0 0 12px; font-size: 22px; }
    .section { margin-bottom: 18px; }
    h3 { margin: 0 0 8px; font-size: 14px; color: #445; text-transform: uppercase; letter-spacing: 0.04em; }
    select, input { width: 100%; padding: 8px 10px; border: 1px solid #ccd3db; border-radius: 10px; box-sizing: border-box; }
    .filters { display: flex; flex-wrap: wrap; gap: 8px; }
    .filter-chip { border: 1px solid #ccd3db; border-radius: 999px; padding: 6px 10px; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; background: #fff; }
    .filter-chip.active { background: #111; color: #fff; border-color: #111; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    #detail { font-size: 13px; line-height: 1.45; color: #223; }
    .empty { color: #667; }
    .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .stat-card { background: #f6f8fb; border: 1px solid #dde3ea; border-radius: 12px; padding: 12px; }
    .num { font-size: 24px; font-weight: 700; }
    .lbl, .meta { font-size: 12px; color: #667; }
    .meta { margin-top: 8px; }
  </style>
</head>
<body>
  <div id="sidebar">
    <h1>Buddy Reasoning Graph</h1>
    <div class="meta">DB: ${escapeHtml(DB_PATH)}</div>
    <div class="meta">Output: ${escapeHtml(outputPath)}</div>

    <div class="section">
      <h3>Project</h3>
      <select id="projectFilter">
        <option value="all">All Projects</option>
        ${projects.map((project) => `<option value="${escapeHtml(project.hash)}">${escapeHtml(project.name)}</option>`).join('')}
      </select>
    </div>

    <div class="section">
      <h3>Date</h3>
      <select id="dateFilter">
        <option value="all">All Dates</option>
      </select>
    </div>

    <div class="section">
      <h3>Search Claims</h3>
      <input id="searchBox" type="text" placeholder="Type to filter claims..." />
    </div>

    <div class="section">
      <h3>Isolate by Basis</h3>
      <div class="filters">
        ${Object.entries(BASIS_COLORS).map(([basis, color]) => `<div class="filter-chip" data-basis="${basis}"><span class="dot" style="background:${color}"></span>${basis}</div>`).join('')}
      </div>
    </div>

    <div class="section">
      <h3>Filter by Edge Type</h3>
      <div class="filters">
        ${Object.entries(EDGE_COLORS).map(([edgeType, color]) => `<div class="filter-chip" data-edge="${edgeType}"><span class="dot" style="background:${color}"></span>${edgeType}</div>`).join('')}
      </div>
    </div>

    <div class="section">
      <h3>Node Detail</h3>
      <div id="detail"><div class="empty">Click a node to see details</div></div>
    </div>

    <div class="section">
      <h3>Stats</h3>
      <div class="stat-grid">
        <div class="stat-card"><div class="num">${stats.claims}</div><div class="lbl">Claims</div></div>
        <div class="stat-card"><div class="num">${stats.edges}</div><div class="lbl">Edges</div></div>
        <div class="stat-card"><div class="num">${stats.findings}</div><div class="lbl">Findings</div></div>
        <div class="stat-card"><div class="num">${stats.sessions}</div><div class="lbl">Sessions</div></div>
      </div>
    </div>
  </div>

  <div id="graph"></div>

  <script>
    const RAW_NODES = ${toScriptJson(visNodes)};
    const RAW_EDGES = ${toScriptJson(visEdges)};
    const SESSION_META = ${toScriptJson(sessionMeta)};
    const DATES_BY_PROJECT = ${toScriptJson(datesByProject)};

    const nodes = new vis.DataSet(RAW_NODES);
    const edges = new vis.DataSet(RAW_EDGES);
    const network = new vis.Network(document.getElementById('graph'), { nodes, edges }, {
      physics: {
        enabled: true,
        solver: 'forceAtlas2Based',
        forceAtlas2Based: {
          gravitationalConstant: -200,
          centralGravity: 0.008,
          springLength: 250,
          springConstant: 0.03,
          damping: 0.5,
          avoidOverlap: 1.0,
        },
        stabilization: { iterations: 400, fit: true },
        minVelocity: 0.75,
      },
      interaction: {
        hover: true,
        tooltipDelay: 100,
        navigationButtons: true,
        keyboard: { enabled: true },
        multiselect: true,
      },
      edges: {
        smooth: { type: 'curvedCW', roundness: 0.15 },
        length: 250,
        font: { size: 12, align: 'middle', color: '#445' },
      },
      layout: { improvedLayout: true, clusterThreshold: 150 },
      nodes: { font: { size: 18 } },
    });

    network.on('stabilizationIterationsDone', () => {
      network.setOptions({ physics: { enabled: false } });
      network.fit({ animation: false });
    });

    const projectFilter = document.getElementById('projectFilter');
    const dateFilter = document.getElementById('dateFilter');
    const searchBox = document.getElementById('searchBox');
    const detail = document.getElementById('detail');
    const activeBases = new Set();
    const activeEdges = new Set();

    function formatDateLabel(rawDate) {
      if (typeof rawDate !== 'string' || !/^\d{8}$/.test(rawDate)) return rawDate;
      return rawDate.slice(0, 4) + '/' + rawDate.slice(4, 6) + '/' + rawDate.slice(6, 8);
    }

    function refreshDates() {
      const project = projectFilter.value;
      const dates = project === 'all'
        ? [...new Set(SESSION_META.map((item) => item.date))]
        : (DATES_BY_PROJECT[project] || []);
      const current = dateFilter.value;

      dateFilter.innerHTML = '';

      const allOption = document.createElement('option');
      allOption.value = 'all';
      allOption.textContent = 'All Dates';
      dateFilter.appendChild(allOption);

      dates.forEach((date) => {
        const option = document.createElement('option');
        option.value = date;
        option.textContent = formatDateLabel(date);
        dateFilter.appendChild(option);
      });

      if (dates.includes(current)) dateFilter.value = current;
    }

    function matchesNode(node) {
      const project = projectFilter.value;
      const date = dateFilter.value;
      const search = searchBox.value.trim().toLowerCase();
      const meta = SESSION_META.find((item) => item.session_id === node.session_id);
      if (project !== 'all' && meta?.hash !== project) return false;
      if (date !== 'all' && meta?.date !== date) return false;
      if (activeBases.size > 0 && !activeBases.has(node.basis)) return false;
      if (search && !String(node.fullText || '').toLowerCase().includes(search)) return false;
      return true;
    }

    function applyFilters() {
      const visibleNodeIds = new Set();
      RAW_NODES.forEach((node) => {
        const hidden = !matchesNode(node);
        nodes.update({ ...node, hidden });
        if (!hidden) visibleNodeIds.add(node.id);
      });

      RAW_EDGES.forEach((edge) => {
        const hiddenByType = activeEdges.size > 0 && !activeEdges.has(edge.type);
        const hiddenByNode = !visibleNodeIds.has(edge.from) || !visibleNodeIds.has(edge.to);
        edges.update({ ...edge, hidden: hiddenByType || hiddenByNode });
      });
    }

    projectFilter.addEventListener('change', () => { refreshDates(); applyFilters(); });
    dateFilter.addEventListener('change', applyFilters);
    searchBox.addEventListener('input', applyFilters);

    document.querySelectorAll('[data-basis]').forEach((element) => {
      element.addEventListener('click', () => {
        const basis = element.getAttribute('data-basis');
        if (!basis) return;
        if (activeBases.has(basis)) activeBases.delete(basis);
        else activeBases.add(basis);
        element.classList.toggle('active');
        applyFilters();
      });
    });

    document.querySelectorAll('[data-edge]').forEach((element) => {
      element.addEventListener('click', () => {
        const edgeType = element.getAttribute('data-edge');
        if (!edgeType) return;
        if (activeEdges.has(edgeType)) activeEdges.delete(edgeType);
        else activeEdges.add(edgeType);
        element.classList.toggle('active');
        applyFilters();
      });
    });

    network.on('click', (params) => {
      if (!params.nodes.length) {
        detail.innerHTML = '<div class="empty">Click a node to see details</div>';
        return;
      }
      const node = nodes.get(params.nodes[0]);
      if (!node) return;
      const safeText = String(node.fullText)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      detail.innerHTML = '<div><strong>' + node.speaker + '</strong> · ' + node.basis + ' · ' + node.confidence + '</div>'
        + '<div class="meta">session: ' + node.session_id + '</div>'
        + '<div style="margin-top:8px">' + safeText + '</div>'
        + '<div class="meta">findings: ' + ((node.findings || []).join(', ') || 'none') + '</div>';
    });

    refreshDates();
    applyFilters();
  </script>
</body>
</html>`;
}

export function generateBuddyGraph(options: {
  sessionId?: string | null;
  outPath?: string | null;
  open?: boolean;
}): { outPath: string; claims: number; edges: number; findings: number; sessions: number } {
  const sessionId = options.sessionId ?? null;
  const outputPath = buildOutputPath(sessionId, options.outPath ?? null);
  const db = new Database(DB_PATH, { readonly: true });
  const sessionClause = sessionId ? 'WHERE session_id = ?' : '';
  const params = sessionId ? [sessionId] : [];

  const claims = db.prepare(`SELECT * FROM reasoning_claims ${sessionClause} ORDER BY created_at`).all(...params) as StoredClaimRow[];
  const edges = db.prepare(`SELECT * FROM reasoning_edges ${sessionClause} ORDER BY created_at`).all(...params) as StoredEdgeRow[];
  const findings = db.prepare(`SELECT * FROM reasoning_findings_log ${sessionClause} ORDER BY created_at`).all(...params) as FindingLogRow[];
  db.close();

  const findingMap = new Map<string, string[]>();
  for (const finding of findings) {
    const list = findingMap.get(finding.anchor_claim_id) || [];
    list.push(finding.finding_type);
    findingMap.set(finding.anchor_claim_id, list);
  }

  const degreeMap = new Map<string, number>();
  for (const edge of edges) {
    degreeMap.set(edge.from_claim, (degreeMap.get(edge.from_claim) || 0) + 1);
    degreeMap.set(edge.to_claim, (degreeMap.get(edge.to_claim) || 0) + 1);
  }

  const sessions = [...new Set(claims.map((claim) => claim.session_id))].sort();
  const sessionMeta = sessions.map((currentSessionId) => {
    const date = currentSessionId.split('-').slice(-1)[0] ?? '';
    const hash = currentSessionId.split('-').slice(0, -1).join('-');
    return {
      session_id: currentSessionId,
      hash,
      date,
      projectName: buildProjectLabel(currentSessionId),
    };
  });

  const projects = [...new Map(sessionMeta.map((meta) => [meta.hash, meta.projectName])).entries()].map(
    ([hash, name]) => ({ hash, name })
  );

  const datesByProject = new Map<string, string[]>();
  for (const meta of sessionMeta) {
    const list = datesByProject.get(meta.hash) || [];
    if (!list.includes(meta.date)) list.push(meta.date);
    datesByProject.set(meta.hash, list.sort());
  }

  const visNodes = claims.map((claim) => {
    const claimFindings = findingMap.get(claim.id) || [];
    const hasCaution = claimFindings.some((finding) => CAUTION_FINDINGS.includes(finding as any));
    const hasKudos = claimFindings.some((finding) => KUDOS_FINDINGS.includes(finding as any));
    const degree = degreeMap.get(claim.id) || 0;
    const borderColor = hasCaution ? '#C62828' : hasKudos ? '#2E7D32' : '#999';

    return {
      id: claim.id,
      label: claim.text.length > 90 ? `${claim.text.slice(0, 87)}…` : claim.text,
      title: claim.text,
      fullText: claim.text,
      basis: claim.basis,
      confidence: claim.confidence,
      speaker: claim.speaker,
      session_id: claim.session_id,
      findings: claimFindings,
      degree,
      shape: claim.speaker === 'user' ? 'diamond' : 'dot',
      color: {
        background: BASIS_COLORS[claim.basis] || '#999999',
        border: borderColor,
        highlight: {
          background: BASIS_COLORS[claim.basis] || '#999999',
          border: borderColor,
        },
      },
      borderWidth: hasCaution || hasKudos ? 3 : 1,
      font: { color: '#111', size: 18, face: 'Inter, system-ui, sans-serif' },
      size: Math.max(18, Math.min(44, 18 + degree * 2)),
    };
  });

  const claimIds = new Set(claims.map((claim) => claim.id));
  const visEdges = edges
    .filter((edge) => claimIds.has(edge.from_claim) && claimIds.has(edge.to_claim))
    .map((edge) => ({
      id: edge.id,
      from: edge.from_claim,
      to: edge.to_claim,
      type: edge.type,
      session_id: edge.session_id,
      color: { color: EDGE_COLORS[edge.type] || '#999999' },
      dashes: edge.type === 'contradicts' || edge.type === 'questions',
      width: edge.type === 'supports' ? 3 : 2,
      arrows: 'to',
      label: edge.type,
      font: { size: 12, align: 'middle', color: '#445', strokeWidth: 3, strokeColor: '#ffffff' },
      title: edge.type,
    }));

  const stats = {
    claims: claims.length,
    edges: visEdges.length,
    findings: findings.length,
    sessions: sessions.length,
  };

  const html = buildHtml({
    outputPath,
    sessions,
    sessionMeta,
    projects,
    datesByProject: Object.fromEntries(datesByProject),
    visNodes,
    visEdges,
    stats,
  });

  writeFileSync(outputPath, html, 'utf-8');

  if (options.open) {
    void openPath(outputPath).catch((error) => {
      console.warn(`Failed to open graph automatically: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  return {
    outPath: outputPath,
    claims: claims.length,
    edges: visEdges.length,
    findings: findings.length,
    sessions: sessions.length,
  };
}

export function runBuddyGraphCli(argv: string[]): number {
  const { sessionId, outPath, open } = parseArgs(argv);
  const result = generateBuddyGraph({ sessionId, outPath, open });
  console.log(`Buddy graph written to ${result.outPath}`);
  console.log(`Claims: ${result.claims} | Edges: ${result.edges} | Findings: ${result.findings} | Sessions: ${result.sessions}`);
  if (open) console.log('Opening graph in browser...');
  return 0;
}
