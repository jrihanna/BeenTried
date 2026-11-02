import { aiEnabled, chatJson, embed } from './ai.js';
import { getDb, toVector } from './db.js';
import { draftsArePublic, logIdeaCheck, type Reason } from './data.js';
import { isTag, TAGS } from './tags.js';

export interface Match {
  slug: string;
  title: string;
  summary: string;
  why_it_fails: string;
  attempt_count: number;
  score: number;
  reasons: Reason[];
  /** How the submitted idea relates to this tarpit. Only filled in AI mode. */
  relation?: string;
}

export interface CheckResult {
  mode: 'ai' | 'keyword';
  summary: string;
  matches: Match[];
  questions: string[];
}

/** Cosine similarity below this is treated as unrelated (tuned for text-embedding-3-small). */
const MIN_SIMILARITY = 0.3;

export async function checkIdea(idea: string): Promise<CheckResult> {
  let result: CheckResult;
  if (aiEnabled()) {
    try {
      result = await checkWithAi(idea);
    } catch (err) {
      console.error('AI idea check failed, falling back to keywords:', err);
      result = await checkWithKeywords(idea);
    }
  } else {
    result = await checkWithKeywords(idea);
  }
  await logIdeaCheck(idea, result.matches.map((m) => m.slug), result.mode).catch(() => {});
  return result;
}

const MATCH_COLUMNS = `
  t.slug, t.title, t.summary, t.why_it_fails,
  (select count(*)::int from attempts a where a.tarpit_id = t.id and a.hidden_at is null) as attempt_count,
  coalesce((select jsonb_agg(jsonb_build_object('tag', r.tag, 'detail', r.detail) order by r.position)
              from reasons r where r.tarpit_id = t.id), '[]'::jsonb) as reasons
`;

async function checkWithAi(idea: string): Promise<CheckResult> {
  const db = await getDb();
  const vector = toVector(await embed(idea));
  const rows = await db.query<Match>(
    `select ${MATCH_COLUMNS}, 1 - (t.embedding <=> $1::vector) as score
       from tarpits t
      where t.embedding is not null and ($2::boolean or t.status = 'reviewed')
      order by t.embedding <=> $1::vector
      limit 3`,
    [vector, draftsArePublic()],
  );
  const matches = rows.filter((m) => m.score >= MIN_SIMILARITY);

  if (matches.length === 0) {
    return { mode: 'ai', summary: noMatchSummary, matches: [], questions: genericQuestions };
  }

  const context = matches
    .map((m) =>
      [
        `slug: ${m.slug}`,
        `title: ${m.title}`,
        `summary: ${m.summary}`,
        `companies that tried: ${m.attempt_count}`,
        `why it fails: ${m.why_it_fails}`,
        `failure reasons: ${m.reasons.map((r) => `${r.tag}: ${r.detail}`).join(' | ')}`,
      ].join('\n'),
    )
    .join('\n\n');

  const ai = await chatJson<{ summary?: string; relations?: Record<string, string>; questions?: string[] }>(
    `You help founders check whether their startup idea is a "tarpit": an idea many smart people
have tried and failed at. You are given the founder's idea and the closest tarpits from a curated
database. Be direct and specific, not discouraging for its own sake: if the idea differs in a way
that sidesteps a known failure mode, say so. Never invent companies or facts beyond what you are given.
Reply with JSON: {"summary": string (2-3 sentences), "relations": {"<slug>": string (one sentence
on how the idea overlaps or differs)}, "questions": string[] (3-4 pointed questions the founder must
answer before building, grounded in the failure reasons)}.`,
    `Founder's idea:\n${idea}\n\nClosest tarpits:\n${context}`,
  );

  return {
    mode: 'ai',
    summary: ai.summary?.trim() || keywordSummary(matches),
    matches: matches.map((m) => ({ ...m, relation: ai.relations?.[m.slug] })),
    questions: ai.questions?.filter((q) => typeof q === 'string').slice(0, 4) ?? questionsFor(matches),
  };
}

async function checkWithKeywords(idea: string): Promise<CheckResult> {
  const db = await getDb();
  const words = [...new Set(idea.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].slice(0, 30);
  if (words.length === 0) {
    return { mode: 'keyword', summary: noMatchSummary, matches: [], questions: genericQuestions };
  }
  // OR the words together with prefix matching, so "delivering" still hits "delivery".
  const tsquery = words.map((w) => `${w}:*`).join(' | ');
  const rows = await db.query<Match>(
    `select ${MATCH_COLUMNS}, ts_rank(t.search, to_tsquery('english', $1)) as score
       from tarpits t
      where t.search @@ to_tsquery('english', $1) and ($2::boolean or t.status = 'reviewed')
      order by score desc
      limit 3`,
    [tsquery, draftsArePublic()],
  );
  // Weak single-word hits are mostly noise, so keep matches near the best one.
  const best = rows[0]?.score ?? 0;
  const matches = rows.filter((m) => m.score >= best * 0.35);

  if (matches.length === 0) {
    return { mode: 'keyword', summary: noMatchSummary, matches: [], questions: genericQuestions };
  }
  return { mode: 'keyword', summary: keywordSummary(matches), matches, questions: questionsFor(matches) };
}

const noMatchSummary =
  "Nothing in the pits looks like this yet. That's either a good sign or a gap in the list, so search for earlier attempts before you build.";

const genericQuestions = [
  TAGS.timing.question,
  TAGS['cold-start'].question,
  TAGS.monetisation.question,
];

function keywordSummary(matches: Match[]): string {
  const [top] = matches;
  const others = matches.length - 1;
  return `Your idea overlaps with “${top.title}”, where ${top.attempt_count} companies in this list have already tried.${
    others > 0 ? ` It also touches ${others} other tarpit${others > 1 ? 's' : ''}.` : ''
  } Read why they failed, then answer the questions below honestly.`;
}

function questionsFor(matches: Match[]): string[] {
  const seen = new Set<string>();
  const questions: string[] = [];
  for (const m of matches) {
    for (const r of m.reasons) {
      if (seen.has(r.tag) || !isTag(r.tag)) continue;
      seen.add(r.tag);
      questions.push(TAGS[r.tag].question);
    }
  }
  if (!seen.has('timing')) questions.push(TAGS.timing.question);
  return questions.slice(0, 4);
}
