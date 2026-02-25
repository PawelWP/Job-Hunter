# JobHunter

A personal job search assistant powered by Claude AI. Paste a job posting URL, pick your CV, and get a detailed match analysis — ATS risks, keyword gaps, an exact edit list, ghost job detection, and a go/no-go recommendation. Discovered jobs and all analyses are tracked in a local dashboard.

## Features

- **CV vs JD analysis** — match score, ATS risk flags, keyword gaps, copy-paste edit list
- **Ghost job detection** — scores each posting for signs it's a compliance/pipeline placeholder
- **Job discovery** — scouts NoFluffJobs and JustJoin.it for QA/automation roles automatically
- **Application tracker** — CRM-style pipeline (New → Applied → Phone Screen → Interview → Offer / Rejected)
- **Web UI** — runs locally at `http://localhost:3000`, no browser extension needed
- **Smart filters** — auto-skips stale postings, low-match roles, or ghost jobs based on your config

## Prerequisites

- **Node.js** 18 or later
- **An Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com)

## First Run

**1. Clone and install dependencies**

```bash
git clone https://github.com/PawelWP/Job-Hunter.git
cd Job-Hunter
npm install
```

**2. Set your API key**

```bash
cp .env.example .env
```

Open `.env` and fill in your key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

**3. Add your CV**

Create a `cvs/` folder and drop your PDF CV inside:

```bash
mkdir cvs
cp /path/to/your-cv.pdf cvs/
```

You can add multiple CV variants — the UI lets you pick which one to use per analysis.

**4. Start the server**

```bash
npm run server
```

Open **http://localhost:3000** in your browser.

---

## Usage

### Analyze a job posting

1. Select your CV from the dropdown
2. Paste a job posting URL (JustJoin.it, NoFluffJobs, LinkedIn, etc.)
3. Click **Analyze** — takes 20–40 seconds
4. Results appear inline; a full HTML report opens automatically

### Discover jobs automatically

1. Configure `search_sites` and `role_keywords` in `jobhunter.config.json` (see below)
2. Click **Scout** in the Discover Jobs section
3. Review the pre-screened list — age badge, salary indicator, ghost warning
4. Check the roles you want to analyze and click **Analyze Selected**

### Track your applications

The Application History table shows every analyzed job with a status dropdown. Update it as you progress through the hiring pipeline — the pipeline bar at the top updates live.

---

## Configuration

Edit `jobhunter.config.json` to tune filtering and discovery:

```json
{
  "min_match_score": 50,
  "max_ghost_score": 40,
  "max_age_days": 10,
  "require_salary": true,
  "work_mode": "remote",
  "role_keywords": ["QA", "automation", "test", "quality"],
  "search_sites": ["nofluffjobs.com", "justjoin.it", "pracuj.pl"]
}
```

| Field | Description |
|---|---|
| `min_match_score` | Skip roles scoring below this threshold (0–100) |
| `max_ghost_score` | Skip postings with ghost risk above this threshold (0–100) |
| `max_age_days` | Warn on postings older than this many days |
| `require_salary` | Flag postings with no salary information |
| `work_mode` | `remote`, `hybrid`, `onsite`, or `any` |
| `role_keywords` | Keywords used to filter discovered job titles |
| `search_sites` | Job boards to scout (supported: `nofluffjobs.com`, `justjoin.it`) |

---

## Project Structure

```
jobhunter/
├── src/
│   ├── server.ts          # Express web UI + API
│   ├── analyzer/
│   │   └── claude.ts      # Claude prompt + response parsing
│   ├── parsers/
│   │   ├── cvParser.ts    # PDF → text
│   │   └── jdScraper.ts   # Job URL → clean text
│   ├── scout/
│   │   └── jobScout.ts    # Job discovery (RSS + JSON-LD)
│   ├── report/
│   │   └── htmlReport.ts  # HTML report + static dashboard generator
│   ├── log/
│   │   └── appLog.ts      # Read/write applications.json
│   ├── config/
│   │   └── userConfig.ts  # Config loading + filter evaluation
│   └── types.ts           # Shared TypeScript interfaces
├── cvs/                   # Drop your CV PDFs here (gitignored)
├── output/                # Generated HTML reports (gitignored)
├── data/                  # applications.json log (gitignored)
├── jobhunter.config.json  # Your personal config
└── .env                   # ANTHROPIC_API_KEY (gitignored)
```

---

## Stack

- **Runtime:** Node.js + TypeScript (via `tsx`, no build step)
- **AI:** Claude Sonnet (`claude-sonnet-4-6`) via Anthropic SDK
- **Web:** Express v5
- **Scraping:** axios + cheerio
- **PDF parsing:** pdf-parse
