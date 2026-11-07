import type { FC } from 'hono/jsx';
import type { Attempt, Comment, TarpitSummary, VoteTally } from '../data.js';
import { VERDICTS, type Verdict } from '../verdicts.js';

export function paragraphs(text: string) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => <p>{p}</p>);
}

export function yearSpan(a: Pick<Attempt, 'start_year' | 'end_year'>): string {
  if (a.start_year && a.end_year) return a.start_year === a.end_year ? `${a.start_year}` : `${a.start_year}–${a.end_year}`;
  if (a.start_year) return `${a.start_year}–`;
  if (a.end_year) return `–${a.end_year}`;
  return 'Year unknown';
}

export function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Thin stacked bars on the index: one bar per attempt, darker as they get deeper. */
export const MiniStrata: FC<{ count: number }> = ({ count }) => {
  const shown = Math.min(count, 8);
  return (
    <span class="mini-strata" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <span style={`--d:${shown > 1 ? i / (shown - 1) : 0}`} />
      ))}
    </span>
  );
};

/** The editor's verdict. Plain tarpits get no badge on the index, so the exceptions stand out. */
export const VerdictBadge: FC<{ verdict: Verdict; always?: boolean }> = ({ verdict, always = false }) =>
  verdict === 'tarpit' && !always ? null : (
    <span class={`badge-verdict verdict-${verdict}`} title={VERDICTS[verdict].description}>
      {VERDICTS[verdict].label}
    </span>
  );

const ReportLink: FC<{ slug: string; a: Attempt }> = ({ slug, a }) => (
  <a
    class="layer-report"
    href={`/t/${slug}/attempts/${a.id}/report`}
    hx-get={`/t/${slug}/attempts/${a.id}/report`}
    hx-target="#report-slot"
    hx-swap="innerHTML"
    rel="nofollow"
  >
    Report a problem<span class="visually-hidden"> with {a.company}</span>
  </a>
);

const CompanyName: FC<{ a: Attempt }> = ({ a }) =>
  a.source_url ? (
    <a href={a.source_url} rel={a.source === 'community' ? 'noopener nofollow ugc' : 'noopener'} target="_blank">
      {a.company}
    </a>
  ) : (
    <>{a.company}</>
  );

/**
 * Companies still pursuing the idea. Kept out of the strata, which are the buried attempts, and
 * worded so nothing here reads as a claim that the company failed.
 */
export const Survivors: FC<{ slug: string; attempts: Attempt[] }> = ({ slug, attempts }) => (
  <ul class="survivors">
    {attempts.map((a) => (
      <li id={`layer-${a.id}`}>
        <span class="layer-years">{a.start_year ? `Since ${a.start_year}` : 'Start year unknown'}</span>
        <span class="layer-company">
          <CompanyName a={a} />
        </span>
        <span class="layer-outcome">{a.outcome}</span>
        {a.notes && <span class="layer-notes">{a.notes}</span>}
        {a.source === 'community' && <span class="layer-credit">Added by {a.suggested_by || 'a visitor'}</span>}
        <ReportLink slug={slug} a={a} />
      </li>
    ))}
  </ul>
);

/**
 * The signature element: attempts drawn as rock strata. Newest at the surface, oldest at
 * the bottom. A layer's thickness follows how many years the attempt lasted.
 */
export const Strata: FC<{ slug: string; attempts: Attempt[] }> = ({ slug, attempts }) => {
  const thisYear = new Date().getFullYear();
  const n = attempts.length;
  return (
    <figure class="strata">
      <figcaption class="strata-edge">Surface, today</figcaption>
      <ol>
        {attempts.map((a, i) => {
          const depth = n > 1 ? i / (n - 1) : 0;
          const years = a.start_year ? Math.max(1, (a.end_year ?? thisYear) - a.start_year) : 1;
          return (
            <li
              id={`layer-${a.id}`}
              class={`layer${depth > 0.45 ? ' deep' : ''}`}
              style={`--d:${depth.toFixed(3)};--years:${Math.min(years, 10)}`}
            >
              <span class="layer-years">{yearSpan(a)}</span>
              <span class="layer-company">
                <CompanyName a={a} />
              </span>
              <span class="layer-outcome">{a.outcome}</span>
              {a.notes && <span class="layer-notes">{a.notes}</span>}
              {a.source === 'community' && (
                <span class="layer-credit">Added by {a.suggested_by || 'a visitor'}</span>
              )}
              <ReportLink slug={slug} a={a} />
            </li>
          );
        })}
      </ol>
      <p class="strata-edge">Earliest attempt</p>
    </figure>
  );
};

export const PitList: FC<{ tarpits: TarpitSummary[]; q?: string }> = ({ tarpits, q }) => (
  <div id="pit-list">
    {tarpits.length === 0 ? (
      <div class="empty">
        <p>
          No tarpit matches “{q}”. That might mean it's fresh ground, or that nobody has written it up yet.
        </p>
        <p>
          <a href={`/check`}>Run it through the idea checker</a> or <a href="/">see every pit</a>.
        </p>
      </div>
    ) : (
      <ol class="pit-list">
        {tarpits.map((t) => (
          <li>
            <a class="pit-row" href={`/t/${t.slug}`}>
              <MiniStrata count={t.attempt_count - t.active_count} />
              <span class="pit-text">
                <span class="pit-title">
                  {t.title} <VerdictBadge verdict={t.verdict} />
                </span>
                <span class="pit-summary">{t.summary}</span>
                <span class="pit-meta">
                  <span>
                    {t.attempt_count} {t.attempt_count === 1 ? 'attempt' : 'attempts'}
                    {t.earliest_year ? ` since ${t.earliest_year}` : ''}
                    {t.active_count > 0 ? `, ${t.active_count} still operating` : ''}
                  </span>
                  <span>{t.category}</span>
                  {t.comment_count > 0 && (
                    <span>
                      {t.comment_count} {t.comment_count === 1 ? 'comment' : 'comments'}
                    </span>
                  )}
                  {t.status === 'draft' && <span class="badge-draft">Unreviewed</span>}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    )}
  </div>
);

export const VoteBox: FC<{ slug: string; tally: VoteTally; verdict: Verdict }> = ({ slug, tally, verdict }) => {
  const total = tally.still + tally.cracked;
  const stillPct = total ? Math.round((tally.still / total) * 100) : 50;
  return (
    <section class="vote" id="vote" aria-labelledby="vote-heading">
      <h2 id="vote-heading">Is this still a tarpit?</h2>
      <p class="hint vote-verdict">
        Our verdict: <VerdictBadge verdict={verdict} always /> {VERDICTS[verdict].description} Your vote is counted
        separately and doesn't change it.
      </p>
      <form method="post" action={`/t/${slug}/vote`} hx-post={`/t/${slug}/vote`} hx-target="#vote" hx-swap="outerHTML">
        <button
          type="submit"
          name="verdict"
          value="still"
          class={tally.mine === 'still' ? 'chosen' : ''}
          aria-pressed={tally.mine === 'still' ? 'true' : 'false'}
        >
          Still a tarpit
        </button>
        <button
          type="submit"
          name="verdict"
          value="cracked"
          class={tally.mine === 'cracked' ? 'chosen' : ''}
          aria-pressed={tally.mine === 'cracked' ? 'true' : 'false'}
        >
          Someone could crack it now
        </button>
      </form>
      {total > 0 ? (
        <div class="tally">
          <div class="tally-bar" role="img" aria-label={`${tally.still} say still a tarpit, ${tally.cracked} say it could be cracked`}>
            <span style={`width:${stillPct}%`} />
          </div>
          <p>
            {tally.still} say still a tarpit, {tally.cracked} say it could be cracked.
          </p>
        </div>
      ) : (
        <p class="tally">No votes yet.</p>
      )}
    </section>
  );
};

export const CommentForm: FC<{ slug: string; parentId?: number }> = ({ slug, parentId }) => {
  const errorId = parentId ? `comment-error-${parentId}` : 'comment-error';
  const target = parentId ? `#replies-${parentId}` : '#comment-list';
  return (
    <form
      class={parentId ? 'comment-form reply-form' : 'comment-form'}
      method="post"
      action={`/t/${slug}/comments`}
      hx-post={`/t/${slug}/comments`}
      hx-target={target}
      hx-swap={parentId ? 'beforeend' : 'afterbegin'}
      hx-on--after-request={
        parentId
          ? 'if (event.detail.successful && !event.detail.xhr.getResponseHeader("HX-Retarget")) this.remove()'
          : 'if (event.detail.successful && !event.detail.xhr.getResponseHeader("HX-Retarget")) this.reset()'
      }
    >
      {parentId && <input type="hidden" name="parent_id" value={String(parentId)} />}
      <label class="hp" aria-hidden="true">
        Leave this empty
        <input type="text" name="website" tabindex={-1} autocomplete="off" />
      </label>
      <label>
        Name
        <input type="text" name="author_name" required maxlength={60} autocomplete="nickname" />
      </label>
      <label>
        {parentId ? 'Reply' : 'What do you know about this one?'}
        <textarea name="body" required minlength={3} maxlength={4000} rows={parentId ? 3 : 5}></textarea>
      </label>
      <p class="form-error" id={errorId} role="alert"></p>
      <button type="submit">{parentId ? 'Post reply' : 'Post comment'}</button>
    </form>
  );
};

export const CommentItem: FC<{ slug: string; comment: Comment; depth?: number }> = ({ slug, comment, depth = 0 }) => (
  <li class="comment" id={`c${comment.id}`}>
    <p class="comment-head">
      <strong>{comment.author_name}</strong>
      <time datetime={new Date(comment.created_at).toISOString()}>{formatDate(comment.created_at)}</time>
    </p>
    <p class="comment-body" id={`cbody-${comment.id}`}>{comment.body}</p>
    {depth < 3 && (
      <button
        type="button"
        class="link-button"
        hx-get={`/t/${slug}/comments/${comment.id}/reply`}
        hx-target={`#reply-slot-${comment.id}`}
        hx-swap="innerHTML"
      >
        Reply
      </button>
    )}
    <a
      class="link-button comment-report"
      href={`/t/${slug}/comments/${comment.id}/report`}
      hx-get={`/t/${slug}/comments/${comment.id}/report`}
      hx-target={`#report-slot-${comment.id}`}
      hx-swap="innerHTML"
      rel="nofollow"
    >
      Report
    </a>
    <div id={`report-slot-${comment.id}`} class="report-slot" aria-live="polite"></div>
    <div id={`reply-slot-${comment.id}`}></div>
    <ol class="replies" id={`replies-${comment.id}`}>
      {comment.replies.map((r) => (
        <CommentItem slug={slug} comment={r} depth={depth + 1} />
      ))}
    </ol>
  </li>
);
