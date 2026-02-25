import axios from 'axios';
import * as cheerio from 'cheerio';

export interface ScrapeResult {
  text: string;
  posting_date: string | null;
}

function normalizeDate(raw: string): string | null {
  const match = raw.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function extractPostingDate($: cheerio.CheerioAPI): string | null {
  // 1. JSON-LD schema.org/JobPosting datePosted
  let found: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (found) return;
    try {
      const data = JSON.parse($(el).text()) as Record<string, unknown>;
      if (typeof data['datePosted'] === 'string') {
        found = normalizeDate(data['datePosted']);
      }
    } catch {
      // skip malformed JSON-LD
    }
  });
  if (found) return found;

  // 2. Open Graph article:published_time
  const og = $('meta[property="article:published_time"]').attr('content');
  if (og) {
    const d = normalizeDate(og);
    if (d) return d;
  }

  // 3. HTML <time datetime="...">
  const timeEl = $('time[datetime]').first().attr('datetime');
  if (timeEl) {
    const d = normalizeDate(timeEl);
    if (d) return d;
  }

  // 4. Generic <meta name="date">
  const metaDate = $('meta[name="date"]').attr('content');
  if (metaDate) {
    const d = normalizeDate(metaDate);
    if (d) return d;
  }

  return null;
}

export async function scrapeJD(url: string): Promise<ScrapeResult> {
  const response = await axios.get(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(response.data as string);

  const posting_date = extractPostingDate($);

  // Remove noise elements
  $('nav, footer, header, script, style, iframe, noscript, .ad, .ads, .advertisement, .cookie-banner, .social-share').remove();

  // Try specific job content selectors first
  const selectors = [
    'main',
    'article',
    '#job-description',
    '.job-description',
    '.job-content',
    '.jobDescription',
    '[data-testid="job-description"]',
    '.description',
    '#jobDescriptionText',
  ];

  for (const selector of selectors) {
    const el = $(selector);
    if (el.length > 0) {
      const text = el.text().replace(/\s+/g, ' ').trim();
      if (text.length > 200) {
        return { text: text.slice(0, 15000), posting_date };
      }
    }
  }

  // Fallback: body text (cap aggressively — body includes a lot of noise)
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  return { text: bodyText.slice(0, 10000), posting_date };
}
