// Shared vocabulary for entry verdicts and company states.

export type Verdict = 'tarpit' | 'contested' | 'cracked';
export type AttemptState = 'ended' | 'active';

export const VERDICTS: Record<Verdict, { label: string; description: string }> = {
  tarpit: {
    label: 'Tarpit',
    description: 'Many have tried and nobody has made it work yet.',
  },
  contested: {
    label: 'Contested',
    description: 'Most attempts failed, but at least one company is making it work.',
  },
  cracked: {
    label: 'Cracked',
    description: 'Someone has made this work. The failures show what had to change.',
  },
};

export function isVerdict(v: unknown): v is Verdict {
  return typeof v === 'string' && Object.hasOwn(VERDICTS, v);
}

export function isAttemptState(v: unknown): v is AttemptState {
  return v === 'ended' || v === 'active';
}

/** A "tarpit" verdict needs at least this many ended companies that each have a source. */
export const MIN_ENDED_FOR_TARPIT = 2;

/** Section headings on the entry page, which read differently once an idea has been cracked. */
export function sectionHeadings(v: Verdict): { fails: string; change: string } {
  if (v === 'cracked') return { fails: 'Why it used to fail', change: 'What changed' };
  if (v === 'contested') return { fails: 'Why it usually fails', change: 'What would have to be true now' };
  return { fails: 'Why it keeps failing', change: 'What would have to be true now' };
}
