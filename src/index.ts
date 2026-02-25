import 'dotenv/config';
import path from 'path';
import { execSync } from 'child_process';
import { parsePDF } from './parsers/cvParser.js';
import { scrapeJD } from './parsers/jdScraper.js';
import { analyzeMatch } from './analyzer/claude.js';
import { logApplication } from './log/appLog.js';
import { generateReport } from './report/htmlReport.js';
import { loadConfig, evaluateFilters } from './config/userConfig.js';

function parseArgs(): { cv: string; jd: string; cvVariant?: string; maxAge: number } {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };

  const cv = get('--cv');
  const jd = get('--jd');

  if (!cv || !jd) {
    console.error('Usage: npx tsx src/index.ts --cv <path-to-pdf> --jd <url> [--cv-variant <name>] [--max-age <days>]');
    process.exit(1);
  }

  const maxAgeRaw = get('--max-age');
  const maxAge = maxAgeRaw !== undefined ? parseInt(maxAgeRaw, 10) : 3;

  return { cv, jd, cvVariant: get('--cv-variant'), maxAge };
}

function computeAgeDays(postingDate: string | null): number | null {
  if (!postingDate) return null;
  const posted = new Date(postingDate).getTime();
  const today = new Date().setHours(0, 0, 0, 0);
  return Math.floor((today - posted) / (1000 * 60 * 60 * 24));
}

function openInBrowser(filePath: string): void {
  const absPath = path.resolve(filePath);
  const url = `file://${absPath}`;
  try {
    const platform = process.platform;
    if (platform === 'darwin') execSync(`open "${url}"`);
    else if (platform === 'win32') execSync(`start "" "${url}"`);
    else execSync(`xdg-open "${url}" 2>/dev/null`);
  } catch {
    // Non-fatal — just skip auto-open
  }
}

async function main(): Promise<void> {
  const { cv, jd, cvVariant, maxAge } = parseArgs();
  const config = loadConfig();

  console.log('\nJobHunter — analyzing...\n');
  console.log(`CV:  ${cv}`);
  console.log(`JD:  ${jd}`);
  if (cvVariant) console.log(`CV variant: ${cvVariant}`);
  console.log('');

  process.stdout.write('Parsing PDF... ');
  const cvText = await parsePDF(path.resolve(cv));
  console.log('done');

  process.stdout.write('Scraping JD...  ');
  const { text: jdText, posting_date } = await scrapeJD(jd);
  console.log('done');

  const estTokens = Math.round((cvText.length + jdText.length) / 4);
  process.stdout.write(`Calling Claude... (~${estTokens} input tokens) `);
  const result = await analyzeMatch(cvText, jdText, jd);
  console.log('done\n');

  const posting_age_days = computeAgeDays(posting_date);
  if (posting_age_days !== null && posting_age_days > maxAge) {
    console.log(`⚠  Stale posting: ${posting_age_days} days old (threshold: ${maxAge}d)\n`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const slug = result.company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const reportFile = `output/report-${slug}-${today}.html`;

  const entry = {
    id: Date.now().toString(),
    company: result.company,
    role: result.role,
    url: jd,
    date: today,
    match_score: result.match_score,
    go_no_go: result.go_no_go,
    report_file: reportFile,
    ghost_score: result.ghost_score,
    posting_date,
    posting_age_days,
    ...(cvVariant ? { cv_variant: cvVariant } : {}),
  };

  const filters = evaluateFilters(config, result, jdText, posting_age_days);

  logApplication(entry);
  const savedReport = generateReport(result, entry, filters);

  // Summary output
  const verdictSymbol = result.go_no_go === 'go' ? '✓ GO' : result.go_no_go === 'maybe' ? '~ MAYBE' : '✗ SKIP';
  const atsHigh = result.ats_risks.filter((r) => r.severity === 'high').length;
  const atsMedium = result.ats_risks.filter((r) => r.severity === 'medium').length;

  console.log(`Analyzing: ${result.role} at ${result.company}`);
  console.log('─'.repeat(50));
  console.log(`Match Score:  ${result.match_score}/100  ${verdictSymbol}`);
  console.log(`Ghost Risk:   ${result.ghost_score}/100`);
  console.log(`ATS Risks:    ${atsHigh} high, ${atsMedium} medium`);
  console.log(`Edit List:    ${result.edit_list.length} specific changes`);
  console.log('');
  if (filters.length > 0) {
    const passed = filters.filter((f) => f.passed).length;
    console.log(`Filters:      ${passed}/${filters.length} passed`);
    filters.filter((f) => !f.passed).forEach((f) => console.log(`  ✗ ${f.name}: ${f.reason}`));
    console.log('');
  }

  console.log(`Report saved: ${savedReport}`);
  console.log(`Dashboard:    output/dashboard.html`);
  console.log('');

  openInBrowser(savedReport);
}

main().catch((err) => {
  console.error('\nError:', err instanceof Error ? err.message : err);
  process.exit(1);
});
