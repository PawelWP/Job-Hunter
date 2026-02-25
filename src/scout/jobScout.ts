import axios from 'axios';
import * as cheerio from 'cheerio';
import type { DiscoveryResult } from '../types.js';
import { loadLog } from '../log/appLog.js';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,pl;q=0.8',
};

function normalizeSite(site: string): string {
  if (site.includes('://')) {
    try { return new URL(site).hostname.replace(/^www\./, ''); } catch { /**/ }
  }
  return site.replace(/^www\./, '');
}

function hasSalary(text: string): boolean {
  return /\d[\d\s]*(?:k\b|PLN|pln|zł|EUR|eur|USD|\$|€)|b2b|uop|salary|wynagrodzenie/i.test(text);
}

function isGhostPreflag(title: string, snippet: string): boolean {
  const t = (title + ' ' + snippet).toLowerCase();
  return ['talent pool', 'pula talent', 'various clients', 'multiple position',
    'ongoing recruitment', 'ciągły nabór', 'always looking', 'pipeline',
    'future opportunit', 'speculative'].some((f) => t.includes(f));
}

function extractCompany(title: string): string | null {
  // "Job Title @ Company Name" — NoFluffJobs RSS format
  const atMatch = title.match(/ @ (.{2,60})$/);
  if (atMatch) return atMatch[1].trim();
  const atLower = title.match(/ at (.{2,40})$/i);
  if (atLower) return atLower[1].trim();
  const pipeMatch = title.match(/\|(.{2,40})$/);
  if (pipeMatch) return pipeMatch[1].trim();
  return null;
}

function rssDateToAgeDays(dateStr: string): number | null {
  try {
    const ms = Date.now() - new Date(dateStr).getTime();
    return Math.max(0, Math.floor(ms / 86_400_000));
  } catch { return null; }
}

/** Convert a justjoin.it URL slug into a readable title. */
function slugToTitle(slug: string): string {
  // slug format: company-jobtitle-parts-city-technology
  // Remove trailing technology (single word, no hyphen) and city
  const parts = slug.split('-').filter(Boolean);
  // Drop last segment (technology) and second-to-last (city)
  const meaningful = parts.length > 2 ? parts.slice(0, -2) : parts;
  return meaningful
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

interface RawResult {
  url: string;
  title: string;
  snippet: string;
  site: string;
  age_days?: number | null;
}

// ── NoFluffJobs — RSS feed ────────────────────────────────────────────────────
async function fetchNoFluffJobsRSS(keywords: string[]): Promise<RawResult[]> {
  const r = await axios.get('https://nofluffjobs.com/rss', {
    headers: { ...HEADERS, Accept: 'application/rss+xml,application/xml,text/xml' },
    timeout: 30000,
    responseType: 'text',
  });

  const $ = cheerio.load(r.data as string, { xmlMode: true });
  const kw = keywords.map((k) => k.toLowerCase());
  const results: RawResult[] = [];

  $('item').each((_, el) => {
    const title = $(el).find('title').text();
    const link = $(el).find('link').text() || $(el).find('guid').text();
    if (!link || !title) return;

    const rawDesc = $(el).find('description').text();
    // Strip HTML tags from description
    const snippet = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    const pubDate = $(el).find('pubDate').text() || $(el).find('dc\\:date').text();

    const searchText = (title + ' ' + snippet).toLowerCase();
    if (kw.some((k) => searchText.includes(k))) {
      results.push({
        url: link,
        title,
        snippet,
        site: 'nofluffjobs.com',
        age_days: rssDateToAgeDays(pubDate),
      });
    }
  });

  return results.slice(0, 30);
}

// ── JustJoin.it — JSON-LD slug filtering ─────────────────────────────────────
async function fetchJustJoinIt(keywords: string[]): Promise<RawResult[]> {
  const r = await axios.get('https://justjoin.it/', {
    headers: { ...HEADERS, Accept: 'text/html' },
    timeout: 20000,
    responseType: 'text',
  });

  const $ = cheerio.load(r.data as string);
  const kw = keywords.map((k) => k.toLowerCase());
  const results: RawResult[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      if (parsed['@type'] !== 'CollectionPage' || !Array.isArray(parsed.hasPart)) return;

      for (const item of parsed.hasPart) {
        const url: string = item.url ?? '';
        if (!url) continue;
        const slug = url.split('/').pop() ?? '';
        if (!kw.some((k) => slug.includes(k))) continue;

        // Derive a readable title from the slug
        const title = slugToTitle(slug);
        results.push({
          url,
          title,
          snippet: slug.replace(/-+/g, ' '),
          site: 'justjoin.it',
          age_days: null,
        });
      }
    } catch { /**/ }
  });

  return results;
}

// ── SearXNG — public meta-search fallback ────────────────────────────────────
const SEARXNG_INSTANCES = [
  'https://searx.be',
  'https://searxng.site',
  'https://darmarit.org/searx',
];

async function searchViaSearXNG(site: string, keywords: string[]): Promise<RawResult[]> {
  const q = `site:${site} ${keywords.join(' ')}`;
  for (const instance of SEARXNG_INSTANCES) {
    try {
      const r = await axios.get(`${instance}/search`, {
        params: { q, format: 'json', categories: 'general', language: 'en-US' },
        headers: { ...HEADERS, Accept: 'application/json' },
        timeout: 12000,
      });
      const results: any[] = (r.data as any)?.results ?? [];
      if (results.length > 0) {
        return results.slice(0, 10).map((res) => ({
          url: res.url ?? '',
          title: res.title ?? '',
          snippet: res.content ?? '',
          site,
        })).filter((res) => res.url);
      }
    } catch { /* try next instance */ }
  }
  return [];
}

// ── Main entry point ──────────────────────────────────────────────────────────
export async function discoverJobs(keywords: string[], sites: string[]): Promise<DiscoveryResult[]> {
  const log = loadLog();
  const seenUrls = new Set(log.map((e) => e.url));

  const raw: RawResult[] = [];

  for (const rawSite of sites) {
    const site = normalizeSite(rawSite);
    try {
      let results: RawResult[];
      if (site === 'nofluffjobs.com') {
        results = await fetchNoFluffJobsRSS(keywords);
      } else if (site === 'justjoin.it') {
        results = await fetchJustJoinIt(keywords);
      } else {
        results = await searchViaSearXNG(site, keywords);
      }
      console.log(`Scout [${site}]: ${results.length} results`);
      raw.push(...results);
      await new Promise((r) => setTimeout(r, 600));
    } catch (e) {
      console.warn(`Scout failed for ${site}:`, e instanceof Error ? e.message : String(e));
    }
  }

  // Deduplicate by URL
  const seenRaw = new Set<string>();
  const unique = raw.filter((r) => {
    if (!r.url || seenRaw.has(r.url)) return false;
    seenRaw.add(r.url);
    return true;
  });

  return unique.map((r) => {
    const alreadySeen = seenUrls.has(r.url);
    const logEntry = alreadySeen ? log.find((e) => e.url === r.url) : undefined;
    const seenDaysAgo = logEntry
      ? Math.floor((Date.now() - new Date(logEntry.date).getTime()) / 86_400_000)
      : null;

    return {
      url: r.url,
      title: r.title,
      company: extractCompany(r.title),
      site: r.site,
      snippet: r.snippet,
      age_days: r.age_days ?? null,
      has_salary: hasSalary(r.title + ' ' + r.snippet),
      ghost_preflag: isGhostPreflag(r.title, r.snippet),
      already_seen: alreadySeen,
      seen_days_ago: seenDaysAgo,
    };
  });
}
