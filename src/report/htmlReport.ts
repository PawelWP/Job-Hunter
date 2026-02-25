import fs from 'fs';
import path from 'path';
import type { AnalysisResult, ApplicationEntry, FilterCheck, ApplicationStatus } from '../types.js';
import { loadLog } from '../log/appLog.js';

const OUTPUT_DIR = path.resolve('output');

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function scoreColor(score: number): string {
  if (score >= 75) return '#22c55e';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
}

function verdictColor(verdict: string): string {
  if (verdict === 'go') return '#22c55e';
  if (verdict === 'maybe') return '#f59e0b';
  return '#ef4444';
}

function verdictLabel(verdict: string): string {
  if (verdict === 'go') return '✓ GO';
  if (verdict === 'maybe') return '~ MAYBE';
  return '✗ SKIP';
}

function severityColor(severity: string): string {
  if (severity === 'high') return '#ef4444';
  if (severity === 'medium') return '#f59e0b';
  return '#3b82f6';
}

function ghostScoreColor(score: number): string {
  if (score < 30) return '#22c55e';
  if (score < 60) return '#f59e0b';
  return '#ef4444';
}

function statusColor(s: ApplicationStatus | undefined): string {
  const colors: Record<ApplicationStatus, string> = {
    new: '#64748b', applied: '#3b82f6', phone_screen: '#8b5cf6',
    interview: '#f59e0b', offer: '#22c55e', rejected: '#ef4444',
  };
  return colors[s ?? 'new'] ?? '#64748b';
}

function statusLabel(s: ApplicationStatus | undefined): string {
  const labels: Record<ApplicationStatus, string> = {
    new: 'New', applied: 'Applied', phone_screen: 'Phone Screen',
    interview: 'Interview', offer: 'Offer', rejected: 'Rejected',
  };
  return labels[s ?? 'new'] ?? 'New';
}

function ageColor(days: number | null): string {
  if (days === null) return '#64748b';
  if (days <= 3) return '#22c55e';
  if (days <= 7) return '#f59e0b';
  return '#ef4444';
}

function renderReport(result: AnalysisResult, entry: ApplicationEntry, filters: FilterCheck[]): string {
  const atsHigh = result.ats_risks.filter((r) => r.severity === 'high').length;
  const atsMedium = result.ats_risks.filter((r) => r.severity === 'medium').length;

  const atsRisksHtml = result.ats_risks
    .map(
      (r) => `
      <div class="card risk-card" style="border-left: 4px solid ${severityColor(r.severity)}">
        <div class="risk-header">
          <span class="badge" style="background:${severityColor(r.severity)}">${r.severity.toUpperCase()}</span>
          <strong>${escapeHtml(r.issue)}</strong>
        </div>
        <div class="fix">💡 ${escapeHtml(r.fix)}</div>
      </div>`,
    )
    .join('');

  const keywordGapsHtml = result.keyword_gaps
    .map(
      (k) => `
      <div class="card">
        <strong>${escapeHtml(k.keyword)}</strong>
        <div class="detail">From JD: <em>"${escapeHtml(k.from_jd)}"</em></div>
        <div class="detail">Suggested placement: ${escapeHtml(k.suggested_placement)}</div>
      </div>`,
    )
    .join('');

  const narrativeHtml = result.narrative_issues
    .map(
      (n) => `
      <div class="card">
        <strong>${escapeHtml(n.issue)}</strong>
        <div class="fix">💡 ${escapeHtml(n.fix)}</div>
      </div>`,
    )
    .join('');

  const editListHtml = result.edit_list
    .map(
      (e) => `
      <div class="card edit-card">
        <div class="edit-header">
          <span class="edit-num">#${e.number}</span>
          <span class="edit-location">${escapeHtml(e.location)}</span>
        </div>
        <div class="edit-row">
          <div class="edit-col">
            <div class="label">Current</div>
            <div class="edit-text current">${escapeHtml(e.current)}</div>
          </div>
          <div class="arrow">→</div>
          <div class="edit-col">
            <div class="label">Change to</div>
            <div class="edit-text change-to">${escapeHtml(e.change_to)}</div>
          </div>
        </div>
        <div class="reason">Reason: ${escapeHtml(e.reason)}</div>
      </div>`,
    )
    .join('');

  const redFlagsHtml = result.hr_red_flags.length
    ? result.hr_red_flags
        .map(
          (f) => `
        <div class="card" style="border-left: 4px solid #f59e0b">
          <strong>🚩 ${escapeHtml(f.flag)}</strong>
          <div class="detail">${escapeHtml(f.detail)}</div>
        </div>`,
        )
        .join('')
    : '<p class="muted">No red flags detected.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JobHunter — ${escapeHtml(result.role)} at ${escapeHtml(result.company)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    .container { max-width: 900px; margin: 0 auto; padding: 2rem 1rem; }
    h1 { font-size: 1.6rem; font-weight: 700; color: #f8fafc; }
    h2 { font-size: 1.1rem; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.08em; margin: 2rem 0 0.75rem; }
    .header { background: #1e293b; border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem; display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap; }
    .score-badge { width: 80px; height: 80px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; font-weight: 800; flex-shrink: 0; }
    .score-num { font-size: 1.8rem; line-height: 1; }
    .score-label { font-size: 0.65rem; opacity: 0.8; }
    .header-info { flex: 1; }
    .role { font-size: 1.3rem; font-weight: 700; color: #f8fafc; }
    .company { color: #94a3b8; margin-top: 0.25rem; }
    .verdict { display: inline-block; padding: 0.35rem 1rem; border-radius: 999px; font-weight: 700; font-size: 1rem; margin-top: 0.5rem; }
    .meta-row { display: flex; gap: 2rem; flex-wrap: wrap; margin-top: 0.5rem; font-size: 0.8rem; color: #64748b; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .stat-card { background: #1e293b; border-radius: 8px; padding: 1rem; text-align: center; }
    .stat-val { font-size: 1.5rem; font-weight: 700; }
    .stat-lbl { font-size: 0.75rem; color: #64748b; margin-top: 0.25rem; }
    .sweet-spot { background: #1e293b; border-radius: 8px; padding: 1rem 1.25rem; color: #a5f3fc; font-style: italic; margin-bottom: 1.5rem; border-left: 4px solid #06b6d4; }
    .card { background: #1e293b; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 0.75rem; }
    .risk-card .risk-header { display: flex; align-items: baseline; gap: 0.5rem; }
    .badge { font-size: 0.65rem; font-weight: 700; padding: 0.2rem 0.5rem; border-radius: 4px; color: #fff; }
    .fix { margin-top: 0.5rem; color: #86efac; font-size: 0.9rem; }
    .detail { color: #94a3b8; font-size: 0.85rem; margin-top: 0.35rem; }
    .edit-card .edit-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
    .edit-num { background: #334155; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.8rem; flex-shrink: 0; }
    .edit-location { color: #94a3b8; font-size: 0.85rem; }
    .edit-row { display: flex; gap: 1rem; align-items: flex-start; }
    .edit-col { flex: 1; }
    .arrow { font-size: 1.2rem; color: #64748b; padding-top: 1.4rem; }
    .label { font-size: 0.7rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem; }
    .edit-text { background: #0f172a; border-radius: 4px; padding: 0.5rem 0.75rem; font-size: 0.85rem; font-family: 'Courier New', monospace; }
    .current { border: 1px solid #ef4444; }
    .change-to { border: 1px solid #22c55e; }
    .reason { margin-top: 0.75rem; font-size: 0.8rem; color: #94a3b8; font-style: italic; }
    .muted { color: #475569; font-style: italic; font-size: 0.9rem; }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .back-link { display: inline-block; margin-bottom: 1rem; font-size: 0.85rem; color: #64748b; }
  </style>
</head>
<body>
  <div class="container">
    <a href="dashboard.html" class="back-link">← Dashboard</a>

    <div class="header">
      <div class="score-badge" style="background: ${scoreColor(result.match_score)}20; border: 3px solid ${scoreColor(result.match_score)}; color: ${scoreColor(result.match_score)}">
        <span class="score-num">${result.match_score}</span>
        <span class="score-label">/ 100</span>
      </div>
      <div class="header-info">
        <div class="role">${escapeHtml(result.role)}</div>
        <div class="company">${escapeHtml(result.company)}</div>
        <div>
          <span class="verdict" style="background: ${verdictColor(result.go_no_go)}20; color: ${verdictColor(result.go_no_go)}; border: 1px solid ${verdictColor(result.go_no_go)}">${verdictLabel(result.go_no_go)}</span>
        </div>
        <div class="meta-row">
          <span>Date: ${entry.date}</span>
          <span>Posted: ${entry.posting_date ?? 'unknown'}${entry.posting_age_days !== null ? ` (${entry.posting_age_days}d ago)` : ''}</span>
          <span><a href="${escapeHtml(entry.url)}" target="_blank">Job posting ↗</a></span>
          ${entry.cv_variant ? `<span>CV: ${escapeHtml(entry.cv_variant)}</span>` : ''}
        </div>
      </div>
    </div>

    ${entry.posting_age_days !== null && entry.posting_age_days > 3 ? `
    <div style="background:${entry.posting_age_days > 7 ? '#ef444420' : '#f59e0b20'}; border:1px solid ${entry.posting_age_days > 7 ? '#ef4444' : '#f59e0b'}; border-radius:8px; padding:0.75rem 1.25rem; margin-bottom:1.5rem; color:${entry.posting_age_days > 7 ? '#ef4444' : '#f59e0b'}">
      ⚠ Stale posting — ${entry.posting_age_days} days old. Response rates drop sharply after 3 days.
    </div>` : ''}

    <div class="summary-grid">
      <div class="stat-card">
        <div class="stat-val" style="color: ${scoreColor(result.match_score)}">${result.match_score}</div>
        <div class="stat-lbl">Match Score</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color: #ef4444">${atsHigh}</div>
        <div class="stat-lbl">High ATS Risks</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color: #f59e0b">${atsMedium}</div>
        <div class="stat-lbl">Medium ATS Risks</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${result.edit_list.length}</div>
        <div class="stat-lbl">Edits Suggested</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${result.keyword_gaps.length}</div>
        <div class="stat-lbl">Keyword Gaps</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color: ${ghostScoreColor(result.ghost_score)}">${result.ghost_score}</div>
        <div class="stat-lbl">Ghost Risk</div>
      </div>
    </div>

    ${result.sweet_spot_note ? `<div class="sweet-spot">${escapeHtml(result.sweet_spot_note)}</div>` : ''}

    <div style="background: #1e293b; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.5rem; border-left: 4px solid ${verdictColor(result.go_no_go)}">
      <strong style="color: ${verdictColor(result.go_no_go)}">${verdictLabel(result.go_no_go)}</strong>
      <span style="color: #94a3b8; margin-left: 0.5rem">${escapeHtml(result.go_no_go_reason)}</span>
    </div>

    ${filters.length > 0 ? `
    <h2>Smart Filter Checks (${filters.filter(f => f.passed).length}/${filters.length} passed)</h2>
    ${filters.map(f => `
      <div class="card" style="border-left: 4px solid ${f.passed ? '#22c55e' : '#ef4444'}; display:flex; align-items:baseline; gap:0.75rem">
        <span style="font-size:1.1rem">${f.passed ? '✓' : '✗'}</span>
        <div>
          <strong style="color:${f.passed ? '#22c55e' : '#ef4444'}">${escapeHtml(f.name)}</strong>
          <span class="detail" style="margin-left:0.5rem">${escapeHtml(f.reason)}</span>
        </div>
      </div>`).join('')}` : ''}

    <h2>Edit List (${result.edit_list.length})</h2>
    ${editListHtml || '<p class="muted">No edits suggested.</p>'}

    <h2>ATS Risks (${result.ats_risks.length})</h2>
    ${atsRisksHtml || '<p class="muted">No ATS risks detected.</p>'}

    <h2>Keyword Gaps (${result.keyword_gaps.length})</h2>
    ${keywordGapsHtml || '<p class="muted">No keyword gaps detected.</p>'}

    <h2>Narrative Issues</h2>
    ${narrativeHtml || '<p class="muted">No narrative issues detected.</p>'}

    <h2>HR Red Flags</h2>
    ${redFlagsHtml}

    <h2>Ghost Job Risk</h2>
    <div class="card" style="border-left: 4px solid ${ghostScoreColor(result.ghost_score)}; margin-bottom: 0.75rem">
      <div style="display:flex; align-items:center; gap:1rem">
        <div style="width:60px; height:60px; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; background:${ghostScoreColor(result.ghost_score)}20; border:3px solid ${ghostScoreColor(result.ghost_score)}; color:${ghostScoreColor(result.ghost_score)}; font-weight:800; flex-shrink:0">
          <span style="font-size:1.3rem; line-height:1">${result.ghost_score}</span>
          <span style="font-size:0.6rem; opacity:0.8">/ 100</span>
        </div>
        <div>
          <strong style="color:${ghostScoreColor(result.ghost_score)}">${result.ghost_score < 30 ? 'Low Risk' : result.ghost_score < 60 ? 'Medium Risk' : 'High Risk'}</strong>
          <div class="detail">${result.ghost_score < 30 ? 'Likely a genuine active posting.' : result.ghost_score < 60 ? 'Proceed with caution — some ghost signals detected.' : 'Strong ghost signals — consider whether this role is worth your time.'}</div>
        </div>
      </div>
    </div>
    ${result.ghost_signals.length
      ? result.ghost_signals.map((s) => `
      <div class="card" style="border-left: 4px solid ${severityColor(s.weight)}">
        <div class="risk-header">
          <span class="badge" style="background:${severityColor(s.weight)}">${s.weight.toUpperCase()}</span>
          <strong>${escapeHtml(s.signal)}</strong>
        </div>
        <div class="detail">${escapeHtml(s.detail)}</div>
      </div>`).join('')
      : '<p class="muted">No ghost signals detected.</p>'
    }
  </div>
</body>
</html>`;
}

function renderDashboard(entries: ApplicationEntry[]): string {
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));

  const rows = sorted
    .map((e) => {
      const color = verdictColor(e.go_no_go);
      const reportFile = path.basename(e.report_file);
      return `
      <tr>
        <td>${e.date}</td>
        <td><strong>${escapeHtml(e.company)}</strong></td>
        <td>${escapeHtml(e.role)}</td>
        <td style="color:#22c55e; font-size:0.82rem">${e.salary ? escapeHtml(e.salary) : '<span style="color:#334155">—</span>'}</td>
        <td style="text-align:center; font-weight:700; color:${scoreColor(e.match_score)}">${e.match_score}</td>
        <td style="text-align:center"><span style="color:${color}; font-weight:600">${verdictLabel(e.go_no_go)}</span></td>
        <td><span style="color:${statusColor(e.status)}; font-weight:600; font-size:0.82rem">${statusLabel(e.status)}</span></td>
        <td style="text-align:center; font-weight:700; color:${ghostScoreColor(e.ghost_score)}">${e.ghost_score}</td>
        <td style="text-align:center; font-weight:700; color:${ageColor(e.posting_age_days)}">${e.posting_age_days !== null ? `${e.posting_age_days}d` : '?'}</td>
        <td style="text-align:center"><a href="${escapeHtml(reportFile)}">Report ↗</a></td>
        <td style="text-align:center"><a href="${escapeHtml(e.url)}" target="_blank">JD ↗</a></td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JobHunter — Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    .container { max-width: 1000px; margin: 0 auto; padding: 2rem 1rem; }
    h1 { font-size: 1.6rem; font-weight: 700; color: #f8fafc; margin-bottom: 0.25rem; }
    .subtitle { color: #64748b; font-size: 0.9rem; margin-bottom: 2rem; }
    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 12px; overflow: hidden; }
    thead { background: #0f172a; }
    th { padding: 0.75rem 1rem; text-align: left; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; }
    td { padding: 0.75rem 1rem; border-bottom: 1px solid #0f172a; font-size: 0.9rem; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #263248; }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .empty { text-align: center; padding: 3rem; color: #475569; }
    .stats-row { display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
    .stat { background: #1e293b; border-radius: 8px; padding: 1rem 1.5rem; text-align: center; }
    .stat-val { font-size: 1.5rem; font-weight: 700; }
    .stat-lbl { font-size: 0.75rem; color: #64748b; margin-top: 0.2rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>JobHunter Dashboard</h1>
    <p class="subtitle">All applications tracked</p>

    <div class="stats-row">
      <div class="stat">
        <div class="stat-val">${entries.length}</div>
        <div class="stat-lbl">Total</div>
      </div>
      <div class="stat">
        <div class="stat-val" style="color:#22c55e">${entries.filter((e) => e.go_no_go === 'go').length}</div>
        <div class="stat-lbl">Go</div>
      </div>
      <div class="stat">
        <div class="stat-val" style="color:#f59e0b">${entries.filter((e) => e.go_no_go === 'maybe').length}</div>
        <div class="stat-lbl">Maybe</div>
      </div>
      <div class="stat">
        <div class="stat-val" style="color:#ef4444">${entries.filter((e) => e.go_no_go === 'skip').length}</div>
        <div class="stat-lbl">Skip</div>
      </div>
      ${entries.length ? `<div class="stat"><div class="stat-val">${Math.round(entries.reduce((s, e) => s + e.match_score, 0) / entries.length)}</div><div class="stat-lbl">Avg Score</div></div>` : ''}
    </div>

    ${
      sorted.length === 0
        ? '<div class="empty">No applications yet.</div>'
        : `<table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Company</th>
          <th>Role</th>
          <th>Salary</th>
          <th style="text-align:center">Score</th>
          <th style="text-align:center">Verdict</th>
          <th>Status</th>
          <th style="text-align:center">Ghost</th>
          <th style="text-align:center">Age</th>
          <th style="text-align:center">Report</th>
          <th style="text-align:center">JD</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`
    }
  </div>
</body>
</html>`;
}

export function generateReport(result: AnalysisResult, entry: ApplicationEntry, filters: FilterCheck[]): string {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const slug = result.company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const reportFile = path.join(OUTPUT_DIR, `report-${slug}-${entry.date}.html`);
  const reportHtml = renderReport(result, entry, filters);
  fs.writeFileSync(reportFile, reportHtml, 'utf-8');

  // Regenerate dashboard
  const allEntries = loadLog();
  const dashboardHtml = renderDashboard(allEntries);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'dashboard.html'), dashboardHtml, 'utf-8');

  return reportFile;
}
