import fs from 'fs';
import path from 'path';
import type { UserConfig, FilterCheck, AnalysisResult } from '../types.js';

const CONFIG_PATH = path.resolve('jobhunter.config.json');

export function loadConfig(): UserConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as UserConfig;
  } catch {
    return {};
  }
}

export function evaluateFilters(
  config: UserConfig,
  result: AnalysisResult,
  jdText: string,
  posting_age_days: number | null,
): FilterCheck[] {
  const checks: FilterCheck[] = [];

  if (config.min_match_score !== undefined) {
    const pass = result.match_score >= config.min_match_score;
    checks.push({
      name: 'Match Score',
      passed: pass,
      reason: `${result.match_score} ${pass ? '≥' : '<'} ${config.min_match_score}`,
    });
  }

  if (config.max_ghost_score !== undefined) {
    const pass = result.ghost_score <= config.max_ghost_score;
    checks.push({
      name: 'Ghost Risk',
      passed: pass,
      reason: `${result.ghost_score} ${pass ? '≤' : '>'} ${config.max_ghost_score}`,
    });
  }

  if (config.max_age_days !== undefined) {
    const pass = posting_age_days === null || posting_age_days <= config.max_age_days;
    checks.push({
      name: 'Freshness',
      passed: pass,
      reason:
        posting_age_days === null
          ? 'Posting date unknown — cannot verify'
          : `${posting_age_days}d ${pass ? '≤' : '>'} ${config.max_age_days}d`,
    });
  }

  if (config.work_mode && config.work_mode !== 'any') {
    const jdLower = jdText.toLowerCase();
    const keywords: Record<string, string[]> = {
      remote: ['remote', 'zdaln', 'home office', 'work from home'],
      hybrid: ['hybrid', 'hybrydow'],
      onsite: ['on-site', 'onsite', 'in office', 'stacjonarnie', 'biuro'],
    };
    const kws = keywords[config.work_mode] ?? [];
    const found = kws.find((k) => jdLower.includes(k));
    const pass = found !== undefined;
    checks.push({
      name: 'Work Mode',
      passed: pass,
      reason: pass ? `${config.work_mode} detected` : `${config.work_mode} required, not found in JD`,
    });
  }

  if (config.require_salary) {
    const jdLower = jdText.toLowerCase();
    const salaryKw = ['salary', 'wynagrodzenie', 'zł', 'pln', 'eur', 'usd', 'b2b', 'uop', 'umowa'];
    const pass = salaryKw.some((k) => jdLower.includes(k));
    checks.push({
      name: 'Salary Visible',
      passed: pass,
      reason: pass ? 'Salary information detected in JD' : 'No salary information found',
    });
  }

  if (config.role_keywords && config.role_keywords.length > 0) {
    const jdLower = jdText.toLowerCase();
    const matched = config.role_keywords.filter((k) => jdLower.includes(k.toLowerCase()));
    const pass = matched.length > 0;
    checks.push({
      name: 'Role Keywords',
      passed: pass,
      reason: pass
        ? `Matched: ${matched.join(', ')}`
        : `None of [${config.role_keywords.join(', ')}] found in JD`,
    });
  }

  return checks;
}
