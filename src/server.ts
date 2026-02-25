import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { parsePDF } from './parsers/cvParser.js';
import { scrapeJD } from './parsers/jdScraper.js';
import { analyzeMatch } from './analyzer/claude.js';
import { logApplication, loadLog, updateEntry } from './log/appLog.js';
import type { ApplicationStatus } from './types.js';
import { generateReport } from './report/htmlReport.js';
import { loadConfig, evaluateFilters } from './config/userConfig.js';
import { discoverJobs } from './scout/jobScout.js';

const app = express();
const PORT = 3000;
const CVS_DIR = path.resolve('cvs');
const OUTPUT_DIR = path.resolve('output');

app.use(express.json());
app.use('/output', express.static(OUTPUT_DIR));

app.get('/api/cvs', (_req: Request, res: Response): void => {
  fs.mkdirSync(CVS_DIR, { recursive: true });
  const files = fs.readdirSync(CVS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort();
  res.json(files);
});

app.get('/api/log', (_req: Request, res: Response): void => {
  res.json(loadLog());
});

const VALID_STATUSES: ApplicationStatus[] = ['new', 'applied', 'phone_screen', 'interview', 'offer', 'rejected'];

app.patch('/api/applications/:id', (req: Request<{ id: string }>, res: Response): void => {
  const { id } = req.params;
  const { status } = req.body as { status?: string };
  if (!status || !VALID_STATUSES.includes(status as ApplicationStatus)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }
  const ok = updateEntry(id, { status: status as ApplicationStatus });
  if (!ok) { res.status(404).json({ error: 'Application not found' }); return; }
  res.json({ ok: true });
});

app.get('/api/scout', async (_req: Request, res: Response) => {
  try {
    const config = loadConfig();
    if (!config.search_sites?.length) {
      res.status(400).json({ error: 'Add "search_sites" to jobhunter.config.json first (e.g. ["nofluffjobs.com", "pracuj.pl"])' });
      return;
    }
    if (!config.role_keywords?.length) {
      res.status(400).json({ error: 'Add "role_keywords" to jobhunter.config.json first' });
      return;
    }
    const results = await discoverJobs(config.role_keywords, config.search_sites);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

function computeAgeDays(postingDate: string | null): number | null {
  if (!postingDate) return null;
  const posted = new Date(postingDate).getTime();
  const today = new Date().setHours(0, 0, 0, 0);
  return Math.floor((today - posted) / (1000 * 60 * 60 * 24));
}

app.post('/api/analyze', async (req: Request, res: Response) => {
  try {
    const { cv, jd } = req.body as { cv?: string; jd?: string };
    if (!cv || !jd) { res.status(400).json({ error: 'cv and jd are required' }); return; }

    const cvPath = path.join(CVS_DIR, path.basename(cv));
    if (!fs.existsSync(cvPath)) { res.status(400).json({ error: `CV not found: ${cv}` }); return; }

    const config = loadConfig();
    const cvText = await parsePDF(cvPath);
    const { text: jdText, posting_date } = await scrapeJD(jd);
    const result = await analyzeMatch(cvText, jdText, jd);

    const posting_age_days = computeAgeDays(posting_date);
    const today = new Date().toISOString().slice(0, 10);
    const slug = result.company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const reportFileName = `report-${slug}-${today}.html`;

    const entry = {
      id: Date.now().toString(),
      company: result.company,
      role: result.role,
      url: jd,
      date: today,
      match_score: result.match_score,
      go_no_go: result.go_no_go,
      report_file: `output/${reportFileName}`,
      ghost_score: result.ghost_score,
      posting_date,
      posting_age_days,
      cv_variant: path.basename(cv, '.pdf'),
      salary: result.salary ?? undefined,
    };

    const filters = evaluateFilters(config, result, jdText, posting_age_days);
    logApplication(entry);
    generateReport(result, entry, filters);

    res.json({
      company: result.company,
      role: result.role,
      match_score: result.match_score,
      go_no_go: result.go_no_go,
      go_no_go_reason: result.go_no_go_reason,
      ghost_score: result.ghost_score,
      ats_high: result.ats_risks.filter((r) => r.severity === 'high').length,
      ats_medium: result.ats_risks.filter((r) => r.severity === 'medium').length,
      edit_count: result.edit_list.length,
      keyword_gaps: result.keyword_gaps.length,
      report_url: `/output/${reportFileName}`,
      filters,
      posting_age_days,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/', (_req: Request, res: Response): void => {
  res.send(renderUI());
});

/* eslint-disable @typescript-eslint/no-explicit-any */
function renderUI(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JobHunter</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    .container { max-width: 960px; margin: 0 auto; padding: 2rem 1rem; }
    h1 { font-size: 1.8rem; font-weight: 800; color: #f8fafc; }
    h2 { font-size: 0.8rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em; margin: 2rem 0 0.75rem; }
    .subtitle { color: #475569; font-size: 0.88rem; margin: 0.3rem 0 2rem; }
    code { background: #1e293b; border-radius: 4px; padding: 0.1rem 0.4rem; font-size: 0.82rem; color: #94a3b8; }
    .form-card { background: #1e293b; border-radius: 12px; padding: 1.5rem; }
    .form-row { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; }
    .field { display: flex; flex-direction: column; gap: 0.4rem; }
    .field label { font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.06em; }
    .url-field { flex: 1; min-width: 260px; }
    select, input[type="url"] { background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 8px; padding: 0.6rem 0.85rem; font-size: 0.95rem; font-family: inherit; width: 100%; }
    select:focus, input:focus { outline: 2px solid #3b82f6; border-color: transparent; }
    button#analyze-btn { background: #3b82f6; color: #fff; border: none; border-radius: 8px; padding: 0.65rem 1.4rem; font-size: 0.95rem; font-weight: 600; cursor: pointer; white-space: nowrap; font-family: inherit; }
    button#analyze-btn:hover:not(:disabled) { background: #2563eb; }
    button#analyze-btn:disabled { background: #1e3a5f; color: #475569; cursor: not-allowed; }
    .status { display: none; align-items: center; gap: 0.75rem; margin-top: 1.25rem; color: #64748b; font-size: 0.88rem; }
    .status.show { display: flex; }
    .spinner { width: 16px; height: 16px; border: 2px solid #1e3a5f; border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.75s linear infinite; flex-shrink: 0; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error-msg { display: none; margin-top: 1rem; background: #450a0a; border: 1px solid #ef4444; border-radius: 8px; padding: 0.75rem 1rem; color: #fca5a5; font-size: 0.88rem; word-break: break-word; }
    .error-msg.show { display: block; }
    .result-card { display: none; background: #1e293b; border-radius: 12px; padding: 1.5rem; margin-top: 1.25rem; }
    .result-card.show { display: block; }
    .result-header { display: flex; align-items: flex-start; gap: 1.25rem; flex-wrap: wrap; }
    .score-badge { width: 72px; height: 72px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; font-weight: 800; flex-shrink: 0; }
    .score-num { font-size: 1.6rem; line-height: 1; }
    .score-lbl { font-size: 0.58rem; opacity: 0.75; }
    .verdict-chip { display: inline-block; padding: 0.25rem 0.8rem; border-radius: 999px; font-weight: 700; font-size: 0.85rem; margin-top: 0.4rem; }
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 0.6rem; margin-top: 1.25rem; }
    .meta-box { background: #0f172a; border-radius: 8px; padding: 0.7rem; text-align: center; }
    .meta-val { font-size: 1.2rem; font-weight: 700; }
    .meta-lbl { font-size: 0.65rem; color: #475569; margin-top: 0.2rem; }
    .filters-section { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #334155; }
    .filter-row { display: flex; gap: 0.5rem; align-items: baseline; font-size: 0.84rem; margin-bottom: 0.3rem; }
    .report-btn { display: inline-block; margin-top: 1.25rem; background: #0f2820; color: #22c55e; border: 1px solid #22c55e40; border-radius: 8px; padding: 0.55rem 1.25rem; font-weight: 600; text-decoration: none; font-size: 0.88rem; }
    .report-btn:hover { background: #14532d; border-color: #22c55e80; }
    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 12px; overflow: hidden; font-size: 0.86rem; }
    thead { background: #0f172a; }
    th { padding: 0.65rem 0.9rem; text-align: left; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em; color: #475569; }
    td { padding: 0.65rem 0.9rem; border-bottom: 1px solid #0f172a; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #243044; }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .empty { text-align: center; padding: 2.5rem; color: #334155; font-size: 0.9rem; }
    .h2-row { display: flex; align-items: center; gap: 0.5rem; }
    .refresh-btn { background: none; border: 1px solid #334155; color: #64748b; border-radius: 6px; padding: 0.25rem 0.65rem; font-size: 0.72rem; cursor: pointer; font-family: inherit; }
    .refresh-btn:hover { border-color: #475569; color: #94a3b8; }
    .discover-card { background: #1e293b; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; }
    .discover-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
    button#scout-btn { background: #6366f1; color: #fff; border: none; border-radius: 8px; padding: 0.65rem 1.4rem; font-size: 0.95rem; font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; }
    button#scout-btn:hover:not(:disabled) { background: #4f46e5; }
    button#scout-btn:disabled { background: #1e3a5f; color: #475569; cursor: not-allowed; }
    .scout-status { display: none; align-items: center; gap: 0.75rem; margin-top: 1rem; color: #64748b; font-size: 0.88rem; }
    .scout-status.show { display: flex; }
    .disc-list { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; }
    .discovery-item { display: flex; align-items: flex-start; gap: 0.75rem; background: #0f172a; border-radius: 8px; padding: 0.75rem 1rem; }
    .discovery-item.seen { opacity: 0.4; }
    .disc-check { margin-top: 0.2rem; flex-shrink: 0; cursor: pointer; accent-color: #6366f1; width: 15px; height: 15px; }
    .disc-info { flex: 1; min-width: 0; }
    .disc-title { font-size: 0.88rem; font-weight: 600; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .disc-meta { font-size: 0.76rem; color: #64748b; margin-top: 0.2rem; }
    .disc-status { font-size: 0.76rem; margin-top: 0.25rem; min-height: 1rem; }
    .analyze-bar { display: none; margin-top: 1rem; align-items: center; gap: 1rem; }
    .analyze-bar.show { display: flex; }
    button#analyze-selected-btn { background: #22c55e; color: #fff; border: none; border-radius: 8px; padding: 0.55rem 1.2rem; font-size: 0.88rem; font-weight: 600; cursor: pointer; font-family: inherit; }
    button#analyze-selected-btn:hover:not(:disabled) { background: #16a34a; }
    button#analyze-selected-btn:disabled { background: #1e3a5f; color: #475569; cursor: not-allowed; }
    .pipeline { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .pipeline-stat { background: #1e293b; border-radius: 8px; padding: 0.6rem 1rem; text-align: center; min-width: 80px; }
    .pipeline-val { font-size: 1.15rem; font-weight: 700; }
    .pipeline-lbl { font-size: 0.65rem; color: #475569; margin-top: 0.15rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .status-select { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 0.2rem 0.4rem; font-size: 0.78rem; font-family: inherit; cursor: pointer; font-weight: 600; }
    .status-select:focus { outline: 1px solid #3b82f6; }
  </style>
</head>
<body>
<div class="container">
  <h1>JobHunter</h1>
  <p class="subtitle">Drop CV PDFs in the <code>cvs/</code> folder, paste a job URL, hit Analyze.</p>

  <div class="form-card">
    <div class="form-row">
      <div class="field">
        <label>CV</label>
        <select id="cv-select"><option value="">Loading...</option></select>
      </div>
      <div class="field url-field">
        <label>Job Posting URL</label>
        <input type="url" id="jd-url" placeholder="https://...">
      </div>
      <button id="analyze-btn" onclick="runAnalysis()">Analyze</button>
    </div>
    <div class="status" id="status">
      <div class="spinner"></div>
      <span>Analyzing — parsing CV, scraping JD, calling Claude. Usually 20–40 seconds.</span>
    </div>
    <div class="error-msg" id="error-msg"></div>
  </div>

  <div class="result-card" id="result-card"></div>

  <div class="discover-card">
    <div class="discover-header">
      <div>
        <div style="font-size:1rem;font-weight:700;color:#f8fafc">Discover Jobs</div>
        <div style="font-size:0.82rem;color:#475569;margin-top:0.2rem">Searches <code>search_sites</code> via DuckDuckGo using your <code>role_keywords</code></div>
      </div>
      <button id="scout-btn" onclick="runScout()">Scout</button>
    </div>
    <div class="scout-status" id="scout-status">
      <div class="spinner"></div>
      <span>Searching job boards\u2026 this takes ~10s per site</span>
    </div>
    <div class="disc-list" id="disc-list"></div>
    <div class="analyze-bar" id="analyze-bar">
      <button id="analyze-selected-btn" disabled onclick="analyzeSelected()">Analyze Selected</button>
      <span id="selected-count" style="color:#64748b;font-size:0.84rem">0 selected</span>
    </div>
  </div>

  <div class="h2-row" style="margin-top:2rem;margin-bottom:0.75rem">
    <h2 style="margin:0">Application History</h2>
    <button class="refresh-btn" onclick="loadHistory()">Refresh</button>
  </div>
  <div class="pipeline" id="pipeline"></div>
  <div id="history"><div class="empty">Loading...</div></div>
</div>

<script>
function sc(n) { return n >= 75 ? '#22c55e' : n >= 60 ? '#f59e0b' : '#ef4444'; }
function vc(v) { return v === 'go' ? '#22c55e' : v === 'maybe' ? '#f59e0b' : '#ef4444'; }
function vl(v) { return v === 'go' ? '\u2713 GO' : v === 'maybe' ? '~ MAYBE' : '\u2717 SKIP'; }
function gc(n) { return n < 30 ? '#22c55e' : n < 60 ? '#f59e0b' : '#ef4444'; }
function ac(d) { return d === null ? '#64748b' : d <= 3 ? '#22c55e' : d <= 7 ? '#f59e0b' : '#ef4444'; }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

var STATUS_COLOR = { new: '#64748b', applied: '#3b82f6', phone_screen: '#8b5cf6', interview: '#f59e0b', offer: '#22c55e', rejected: '#ef4444' };
var STATUS_LABEL = { new: 'New', applied: 'Applied', phone_screen: 'Phone Screen', interview: 'Interview', offer: 'Offer', rejected: 'Rejected' };
function stc(s) { return STATUS_COLOR[s || 'new'] || '#64748b'; }
function stl(s) { return STATUS_LABEL[s || 'new'] || 'New'; }

async function updateStatus(sel) {
  var id = sel.dataset.id;
  var status = sel.value;
  sel.style.color = stc(status);
  try {
    var r = await fetch('/api/applications/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: status })
    });
    if (!r.ok) throw new Error('Save failed');
  } catch(e) {
    sel.style.color = '#ef4444';
  }
}

function statusSelect(e) {
  var statuses = ['new','applied','phone_screen','interview','offer','rejected'];
  var cur = e.status || 'new';
  return '<select class="status-select" data-id="' + esc(e.id) + '" onchange="updateStatus(this)" style="color:' + stc(cur) + '">' +
    statuses.map(function(s) {
      return '<option value="' + s + '"' + (cur === s ? ' selected' : '') + '>' + stl(s) + '</option>';
    }).join('') +
    '</select>';
}

async function loadCVs() {
  try {
    var r = await fetch('/api/cvs');
    var cvs = await r.json();
    var sel = document.getElementById('cv-select');
    if (!cvs.length) {
      sel.innerHTML = '<option value="">No PDFs in cvs/ — add some first</option>';
    } else {
      sel.innerHTML = cvs.map(function(f) { return '<option value="' + esc(f) + '">' + esc(f) + '</option>'; }).join('');
    }
  } catch(e) {
    document.getElementById('cv-select').innerHTML = '<option value="">Error loading CVs</option>';
  }
}

async function loadHistory() {
  try {
    var r = await fetch('/api/log');
    var log = await r.json();
    var el = document.getElementById('history');
    var pl = document.getElementById('pipeline');

    if (!log.length) {
      el.innerHTML = '<div class="empty">No applications yet.</div>';
      pl.innerHTML = '';
      return;
    }

    var sorted = log.slice().sort(function(a, b) { return b.date < a.date ? -1 : 1; });

    // Pipeline stats
    var counts = { new: 0, applied: 0, phone_screen: 0, interview: 0, offer: 0, rejected: 0 };
    log.forEach(function(e) { var s = e.status || 'new'; if (counts[s] !== undefined) counts[s]++; });
    pl.innerHTML =
      '<div class="pipeline-stat"><div class="pipeline-val">' + log.length + '</div><div class="pipeline-lbl">Total</div></div>' +
      '<div class="pipeline-stat"><div class="pipeline-val" style="color:#3b82f6">' + counts.applied + '</div><div class="pipeline-lbl">Applied</div></div>' +
      '<div class="pipeline-stat"><div class="pipeline-val" style="color:#8b5cf6">' + counts.phone_screen + '</div><div class="pipeline-lbl">Screening</div></div>' +
      '<div class="pipeline-stat"><div class="pipeline-val" style="color:#f59e0b">' + counts.interview + '</div><div class="pipeline-lbl">Interview</div></div>' +
      '<div class="pipeline-stat"><div class="pipeline-val" style="color:#22c55e">' + counts.offer + '</div><div class="pipeline-lbl">Offer</div></div>' +
      '<div class="pipeline-stat"><div class="pipeline-val" style="color:#ef4444">' + counts.rejected + '</div><div class="pipeline-lbl">Rejected</div></div>';

    el.innerHTML = '<table><thead><tr>' +
      '<th>Date</th><th>Company</th><th>Role</th><th>Salary</th>' +
      '<th style="text-align:center">Score</th><th style="text-align:center">Verdict</th>' +
      '<th>Status</th>' +
      '<th style="text-align:center">Ghost</th><th style="text-align:center">Age</th>' +
      '<th style="text-align:center">Report</th><th style="text-align:center">JD</th>' +
      '</tr></thead><tbody>' +
      sorted.map(function(e) {
        return '<tr>' +
          '<td>' + esc(e.date) + '</td>' +
          '<td><strong>' + esc(e.company) + '</strong></td>' +
          '<td>' + esc(e.role) + '</td>' +
          '<td style="color:#22c55e;font-size:0.82rem">' + (e.salary ? esc(e.salary) : '<span style="color:#334155">—</span>') + '</td>' +
          '<td style="text-align:center;font-weight:700;color:' + sc(e.match_score) + '">' + e.match_score + '</td>' +
          '<td style="text-align:center;color:' + vc(e.go_no_go) + ';font-weight:600">' + vl(e.go_no_go) + '</td>' +
          '<td>' + statusSelect(e) + '</td>' +
          '<td style="text-align:center;font-weight:700;color:' + gc(e.ghost_score) + '">' + e.ghost_score + '</td>' +
          '<td style="text-align:center;font-weight:700;color:' + ac(e.posting_age_days) + '">' + (e.posting_age_days !== null ? e.posting_age_days + 'd' : '?') + '</td>' +
          '<td style="text-align:center"><a href="' + esc(e.report_file) + '" target="_blank">Report \u2197</a></td>' +
          '<td style="text-align:center"><a href="' + esc(e.url) + '" target="_blank">JD \u2197</a></td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>';
  } catch(e) {
    document.getElementById('history').innerHTML = '<div class="empty">Error loading history.</div>';
  }
}

async function runScout() {
  var btn = document.getElementById('scout-btn');
  var statusEl = document.getElementById('scout-status');
  var listEl = document.getElementById('disc-list');
  var barEl = document.getElementById('analyze-bar');
  btn.disabled = true;
  statusEl.classList.add('show');
  listEl.innerHTML = '';
  barEl.classList.remove('show');
  try {
    var r = await fetch('/api/scout');
    var data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Scout failed');
    renderDiscovery(data);
  } catch(e) {
    listEl.innerHTML = '<div style="color:#ef4444;font-size:0.85rem;padding:0.5rem 0">' + esc(e.message) + '</div>';
  } finally {
    btn.disabled = false;
    statusEl.classList.remove('show');
  }
}

function renderDiscovery(results) {
  var listEl = document.getElementById('disc-list');
  var barEl = document.getElementById('analyze-bar');
  if (!results.length) {
    listEl.innerHTML = '<div style="color:#64748b;font-size:0.85rem;padding:0.5rem 0">No results found. Check <code>search_sites</code> and <code>role_keywords</code> in jobhunter.config.json.</div>';
    return;
  }
  listEl.innerHTML = results.map(function(r) {
    var age = r.age_days !== null ? r.age_days : null;
    var ageC = age === null ? '#64748b' : age <= 3 ? '#22c55e' : age <= 7 ? '#f59e0b' : '#ef4444';
    var badges = age !== null ? ' \u00b7 <span style="color:' + ageC + '">' + age + 'd</span>' : '';
    if (r.has_salary) badges += ' \u00b7 \ud83d\udcb0';
    if (r.ghost_preflag) badges += ' \u00b7 <span style="color:#f59e0b">\u26a0 ghost?</span>';
    if (r.already_seen) badges += ' \u00b7 <span style="color:#64748b">seen' + (r.seen_days_ago !== null ? ' ' + r.seen_days_ago + 'd ago' : '') + '</span>';
    return '<div class="discovery-item' + (r.already_seen ? ' seen' : '') + '">' +
      '<input type="checkbox" class="disc-check" value="' + esc(r.url) + '"' +
      (r.already_seen ? ' disabled' : '') + ' onchange="updateSelectedCount()">' +
      '<div class="disc-info">' +
        '<div class="disc-title">' + esc(r.title) + '</div>' +
        '<div class="disc-meta">' + (r.company ? esc(r.company) + ' \u00b7 ' : '') + '<span style="color:#475569">' + esc(r.site) + '</span>' + badges + '</div>' +
        '<div class="disc-status"></div>' +
      '</div>' +
      '<a href="' + esc(r.url) + '" target="_blank" style="color:#60a5fa;font-size:0.78rem;flex-shrink:0">\u2197</a>' +
    '</div>';
  }).join('');
  barEl.classList.add('show');
  updateSelectedCount();
}

function updateSelectedCount() {
  var n = document.querySelectorAll('.disc-check:checked').length;
  document.getElementById('selected-count').textContent = n + ' selected';
  document.getElementById('analyze-selected-btn').disabled = n === 0;
}

async function analyzeSelected() {
  var checks = Array.from(document.querySelectorAll('.disc-check:checked'));
  var cv = document.getElementById('cv-select').value;
  if (!cv) { alert('Select a CV first (top form).'); return; }
  var btn = document.getElementById('analyze-selected-btn');
  btn.disabled = true;
  for (var i = 0; i < checks.length; i++) {
    var url = checks[i].value;
    var item = checks[i].closest('.discovery-item');
    var statusEl = item ? item.querySelector('.disc-status') : null;
    if (statusEl) { statusEl.textContent = 'Analyzing\u2026'; statusEl.style.color = '#f59e0b'; }
    try {
      var r = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv: cv, jd: url })
      });
      var d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      if (statusEl) {
        var sColor = sc(d.match_score);
        statusEl.innerHTML = '<span style="color:' + sColor + '">' + d.match_score + '/100 ' + vl(d.go_no_go) + '</span>' +
          ' \u00b7 <a href="' + esc(d.report_url) + '" target="_blank" style="color:#60a5fa">Report \u2197</a>';
      }
      checks[i].checked = false;
      checks[i].disabled = true;
    } catch(e) {
      if (statusEl) { statusEl.textContent = e.message; statusEl.style.color = '#ef4444'; }
    }
    updateSelectedCount();
  }
  btn.disabled = false;
  loadHistory();
}

async function runAnalysis() {
  var cv = document.getElementById('cv-select').value;
  var jd = document.getElementById('jd-url').value.trim();
  if (!cv) { alert('Please select a CV from the dropdown.'); return; }
  if (!jd) { alert('Please enter a job posting URL.'); return; }

  var btn = document.getElementById('analyze-btn');
  var statusEl = document.getElementById('status');
  var errorEl = document.getElementById('error-msg');
  var resultEl = document.getElementById('result-card');

  btn.disabled = true;
  statusEl.classList.add('show');
  errorEl.classList.remove('show');
  resultEl.classList.remove('show');

  try {
    var r = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cv: cv, jd: jd })
    });
    var d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Analysis failed');
    renderResult(d);
    loadHistory();
  } catch(e) {
    errorEl.textContent = e.message;
    errorEl.classList.add('show');
  } finally {
    btn.disabled = false;
    statusEl.classList.remove('show');
  }
}

function renderResult(d) {
  var sColor = sc(d.match_score);
  var vColor = vc(d.go_no_go);
  var gColor = gc(d.ghost_score);

  var filtersHtml = '';
  if (d.filters && d.filters.length) {
    var passed = d.filters.filter(function(f) { return f.passed; }).length;
    filtersHtml = '<div class="filters-section">' +
      '<div style="font-size:0.7rem;color:#475569;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.5rem">Filters \u2014 ' + passed + '/' + d.filters.length + ' passed</div>' +
      d.filters.map(function(f) {
        var c = f.passed ? '#22c55e' : '#ef4444';
        return '<div class="filter-row">' +
          '<span style="color:' + c + '">' + (f.passed ? '\u2713' : '\u2717') + '</span>' +
          '<span style="color:' + c + ';font-weight:600">' + esc(f.name) + '</span>' +
          '<span style="color:#64748b">' + esc(f.reason) + '</span></div>';
      }).join('') +
      '</div>';
  }

  var ageHtml = d.posting_age_days !== null
    ? '<div class="meta-box"><div class="meta-val" style="color:' + ac(d.posting_age_days) + '">' + d.posting_age_days + 'd</div><div class="meta-lbl">Age</div></div>'
    : '';

  document.getElementById('result-card').innerHTML =
    '<div class="result-header">' +
      '<div class="score-badge" style="background:' + sColor + '20;border:3px solid ' + sColor + ';color:' + sColor + '">' +
        '<span class="score-num">' + d.match_score + '</span>' +
        '<span class="score-lbl">/ 100</span>' +
      '</div>' +
      '<div style="flex:1">' +
        '<div style="font-size:1.1rem;font-weight:700;color:#f8fafc">' + esc(d.role) + '</div>' +
        '<div style="color:#64748b;margin-top:0.2rem">' + esc(d.company) + '</div>' +
        '<span class="verdict-chip" style="background:' + vColor + '20;color:' + vColor + ';border:1px solid ' + vColor + '40">' + vl(d.go_no_go) + '</span>' +
        '<div style="color:#64748b;font-size:0.84rem;margin-top:0.5rem">' + esc(d.go_no_go_reason) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="meta-grid">' +
      '<div class="meta-box"><div class="meta-val" style="color:#ef4444">' + d.ats_high + '</div><div class="meta-lbl">High ATS</div></div>' +
      '<div class="meta-box"><div class="meta-val" style="color:#f59e0b">' + d.ats_medium + '</div><div class="meta-lbl">Med ATS</div></div>' +
      '<div class="meta-box"><div class="meta-val">' + d.edit_count + '</div><div class="meta-lbl">Edits</div></div>' +
      '<div class="meta-box"><div class="meta-val">' + d.keyword_gaps + '</div><div class="meta-lbl">Gaps</div></div>' +
      '<div class="meta-box"><div class="meta-val" style="color:' + gColor + '">' + d.ghost_score + '</div><div class="meta-lbl">Ghost Risk</div></div>' +
      ageHtml +
    '</div>' +
    filtersHtml +
    '<a href="' + esc(d.report_url) + '" target="_blank" class="report-btn">View Full Report \u2197</a>';

  document.getElementById('result-card').classList.add('show');
}

loadCVs();
loadHistory();
</script>
</body>
</html>`;
}

const server = app.listen(PORT, () => {
  console.log('\nJobHunter UI  \u2192  http://localhost:' + PORT + '\n');
  console.log('Drop CV PDFs in:  ' + CVS_DIR + '\n');
  console.log('Press Ctrl+C to stop.\n');
});

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
