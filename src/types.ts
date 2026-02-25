export interface ATSRisk {
  severity: 'high' | 'medium' | 'low';
  issue: string;
  fix: string;
}

export interface KeywordGap {
  keyword: string;
  from_jd: string;
  suggested_placement: string;
}

export interface NarrativeIssue {
  issue: string;
  fix: string;
}

export interface EditItem {
  number: number;
  location: string;
  current: string;
  change_to: string;
  reason: string;
}

export interface HRRedFlag {
  flag: string;
  detail: string;
}

export interface GhostSignal {
  signal: string;
  detail: string;
  weight: 'high' | 'medium' | 'low';
}

export interface AnalysisResult {
  company: string;
  role: string;
  match_score: number;
  go_no_go: 'go' | 'maybe' | 'skip';
  go_no_go_reason: string;
  ats_risks: ATSRisk[];
  keyword_gaps: KeywordGap[];
  narrative_issues: NarrativeIssue[];
  edit_list: EditItem[];
  hr_red_flags: HRRedFlag[];
  sweet_spot_note: string;
  salary?: string;
  ghost_score: number;
  ghost_signals: GhostSignal[];
}

export interface UserConfig {
  min_match_score?: number;
  max_ghost_score?: number;
  max_age_days?: number;
  require_salary?: boolean;
  work_mode?: 'remote' | 'hybrid' | 'onsite' | 'any';
  role_keywords?: string[];
  search_sites?: string[];
}

export interface DiscoveryResult {
  url: string;
  title: string;
  company: string | null;
  site: string;
  snippet: string;
  age_days: number | null;
  has_salary: boolean;
  ghost_preflag: boolean;
  already_seen: boolean;
  seen_days_ago: number | null;
}

export interface FilterCheck {
  name: string;
  passed: boolean;
  reason: string;
}

export type ApplicationStatus = 'new' | 'applied' | 'phone_screen' | 'interview' | 'offer' | 'rejected';

export interface ApplicationEntry {
  id: string;
  company: string;
  role: string;
  url: string;
  date: string;
  match_score: number;
  go_no_go: 'go' | 'maybe' | 'skip';
  report_file: string;
  cv_variant?: string;
  ghost_score: number;
  posting_date: string | null;
  posting_age_days: number | null;
  status?: ApplicationStatus;
  salary?: string;
}
