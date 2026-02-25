import Anthropic from '@anthropic-ai/sdk';
import { APIError } from '@anthropic-ai/sdk/core/error.js';
import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages.js';
import type { AnalysisResult } from '../types.js';

const client = new Anthropic({ maxRetries: 0 });

function buildPrompt(cvText: string, jdText: string, url: string): string {
  return `You are an expert HR analyst and ATS specialist. Analyze the CV against this job description.

Return ONLY valid JSON with this exact structure:
{
  "company": "...",
  "role": "...",
  "match_score": 74,
  "go_no_go": "go|maybe|skip",
  "go_no_go_reason": "...",
  "ats_risks": [
    { "severity": "high|medium|low", "issue": "...", "fix": "..." }
  ],
  "keyword_gaps": [
    { "keyword": "...", "from_jd": "exact phrase", "suggested_placement": "..." }
  ],
  "narrative_issues": [
    { "issue": "...", "fix": "..." }
  ],
  "edit_list": [
    { "number": 1, "location": "...", "current": "...", "change_to": "...", "reason": "..." }
  ],
  "hr_red_flags": [
    { "flag": "...", "detail": "..." }
  ],
  "sweet_spot_note": "...",
  "salary": "16000-25000 PLN B2B",
  "ghost_score": 45,
  "ghost_signals": [
    { "signal": "...", "detail": "...", "weight": "high|medium|low" }
  ]
}

Rules:
- match_score 70-80 = ideal range, flag if <60 (skip) or >90 (overqualified risk)
- go = 65-85 match, go_no_go reasoning must be specific
- edit_list entries must be copy-pasteable exact text replacements
- hr_red_flags: note any ghost job signals (vague JD, no tech stack, generic requirements)
- Apply Polish market awareness: flag missing B2B/UoP clarification on salary
- ghost_score 0-29 = low risk (genuine posting), 30-59 = medium risk, 60-100 = high risk (likely ghost/compliance posting)
- ghost_signals: list concrete evidence from the JD text, not generic observations; signals include: vague requirements with no specific tech stack, no concrete deliverables or team size, salary range spread >40%, missing B2B/UoP clarification on Polish remote roles, contradictory seniority expectations, compliance/pipeline posting language
- Always check Polish market signals: missing B2B/UoP on Polish remote roles is always a ghost_signal
- salary: extract the exact salary range from the JD (e.g. "16000-25000 PLN B2B", "140-160 PLN/h B2B", "€60k-€80k"); set to null if not mentioned

CV:
---
${cvText}
---

Job Description (from ${url}):
---
${jdText}
---`;
}

const RETRY_DELAYS_MS = [30_000, 60_000, 120_000];

async function callWithRetry(params: MessageCreateParamsNonStreaming): Promise<Message> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (err) {
      const isOverloaded = err instanceof APIError && err.status === 529;
      if (isOverloaded && attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt];
        process.stdout.write(`\n  API overloaded — waiting ${delay / 1000}s before retry ${attempt + 1}/${RETRY_DELAYS_MS.length}...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Unreachable');
}

export async function analyzeMatch(
  cvText: string,
  jdText: string,
  jdUrl: string,
): Promise<AnalysisResult> {
  const message = await callWithRetry({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: buildPrompt(cvText, jdText, jdUrl),
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }

  // Strip markdown code fences if present
  const raw = content.text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  try {
    return JSON.parse(raw) as AnalysisResult;
  } catch {
    throw new Error(`Failed to parse Claude response as JSON:\n${content.text}`);
  }
}
