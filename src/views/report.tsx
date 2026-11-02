import type { FC } from 'hono/jsx';
import {
  COMMENT_REPORT_REASONS,
  complaintsEmail,
  REPORT_REASONS,
  type ReportedComment,
  type ReportedCompany,
  type ReportValues,
  type Triage,
} from '../reports.js';
import type { SuggestionValues } from '../suggestions.js';
import { Layout } from './layout.js';
import { formatDate, yearSpan } from './parts.js';
import { SuggestionFields } from './suggest.js';

// ---------- Visitor report forms ----------

/** The form shared by company and comment reports. Ids are prefixed so several can be open at once. */
const ReportFormBase: FC<{
  action: string;
  target: string;
  prefix: string;
  heading: string;
  intro: string;
  reasons: Record<string, string>;
  requireDetails: boolean;
  cancelHref: string;
  cancelGet: string;
  values?: ReportValues;
  error?: string;
}> = ({ action, target, prefix, heading, intro, reasons, requireDetails, cancelHref, cancelGet, values = {}, error }) => {
  const id = (name: string) => `${prefix}-${name}`;
  const email = complaintsEmail();
  return (
    <form
      class="suggest-form report-form"
      method="post"
      action={action}
      hx-post={action}
      hx-target={target}
      hx-swap="innerHTML"
    >
      <h3>{heading}</h3>
      <p class="hint">{intro}</p>
      <label class="hp" aria-hidden="true">
        Leave this empty
        <input type="text" name="website" tabindex={-1} autocomplete="off" />
      </label>
      <label for={id('reason')}>What's wrong?</label>
      <select id={id('reason')} name="reason" required autofocus>
        <option value="">Choose one</option>
        {Object.entries(reasons).map(([key, label]) => (
          <option value={key} selected={values.reason === key}>
            {label}
          </option>
        ))}
      </select>
      <label for={id('details')}>{requireDetails ? 'Details' : 'Details (optional)'}</label>
      <textarea
        id={id('details')}
        name="details"
        required={requireDetails}
        minlength={requireDetails ? 10 : undefined}
        maxlength={2000}
        rows={4}
      >
        {values.details ?? ''}
      </textarea>
      <label for={id('email')}>Your email, if you'd like a reply (optional)</label>
      <input id={id('email')} type="email" name="email" maxlength={200} autocomplete="email" value={values.email ?? ''} />
      <p class="hint">
        Only used to reply about this report. See the <a href="/privacy">privacy policy</a>.
      </p>
      {email && (
        <p class="hint">
          For a formal complaint, email <a href={`mailto:${email}`}>{email}</a>.
        </p>
      )}
      <p class="form-error" id={id('error')} role="alert">
        {error ?? ''}
      </p>
      <div class="form-actions">
        <button type="submit">Send report</button>
        <a href={cancelHref} hx-get={cancelGet} hx-target={target} hx-swap="innerHTML">
          Cancel
        </a>
      </div>
    </form>
  );
};

/** Error slot ids, used by the routes to retarget validation messages. */
export const attemptReportErrorId = () => 'rp-error';
export const commentReportErrorId = (commentId: number) => `crp${commentId}-error`;

export const ReportForm: FC<{
  slug: string;
  attemptId: number;
  company: string;
  values?: ReportValues;
  error?: string;
}> = ({ slug, attemptId, company, values, error }) => (
  <ReportFormBase
    action={`/t/${slug}/attempts/${attemptId}/report`}
    target="#report-slot"
    prefix="rp"
    heading={`Report a problem with ${company}`}
    intro="We hide it from this page while we check it against the source."
    reasons={REPORT_REASONS}
    requireDetails={true}
    cancelHref={`/t/${slug}`}
    cancelGet={`/t/${slug}/report/cancel`}
    values={values}
    error={error}
  />
);

export const CommentReportForm: FC<{
  slug: string;
  commentId: number;
  author: string;
  values?: ReportValues;
  error?: string;
}> = ({ slug, commentId, author, values, error }) => (
  <ReportFormBase
    action={`/t/${slug}/comments/${commentId}/report`}
    target={`#report-slot-${commentId}`}
    prefix={`crp${commentId}`}
    heading={`Report this comment by ${author}`}
    intro="We hide it while we take a look."
    reasons={COMMENT_REPORT_REASONS}
    requireDetails={false}
    cancelHref={`/t/${slug}#c${commentId}`}
    cancelGet={`/t/${slug}/report/cancel`}
    values={values}
    error={error}
  />
);

export const CommentReportThanks: FC<{ replyTo: boolean }> = ({ replyTo }) => (
  <div class="suggest-thanks" role="status">
    <p>
      Thanks. The comment is hidden while we take a look.
      {replyTo ? " We'll reply by email." : ''}
    </p>
  </div>
);

/** Full-page version of the comment report form for visitors without JavaScript. */
export const CommentReportPage: FC<{
  slug: string;
  title: string;
  commentId: number;
  author: string;
  values?: ReportValues;
  error?: string;
  sent?: { replyTo: boolean };
  notice?: string;
}> = ({ slug, title, commentId, author, values, error, sent, notice }) => (
  <Layout title="Report a comment">
    <div class="prose">
      <p class="crumbs">
        <a href={`/t/${slug}#comments`}>{title}</a>
      </p>
      <div id={`report-slot-${commentId}`}>
        {notice ? (
          <p>{notice}</p>
        ) : sent ? (
          <CommentReportThanks replyTo={sent.replyTo} />
        ) : (
          <CommentReportForm slug={slug} commentId={commentId} author={author} values={values} error={error} />
        )}
      </div>
    </div>
  </Layout>
);

export const ReportThanks: FC<{ company: string; replyTo: boolean }> = ({ company, replyTo }) => (
  <div class="suggest-thanks" role="status">
    <p>
      Thanks. {company} is hidden from this page while we check it.
      {replyTo ? " We'll reply by email." : ''}
    </p>
  </div>
);

/** Full-page version for visitors without JavaScript. */
export const ReportPage: FC<{
  slug: string;
  title: string;
  attemptId: number;
  company: string;
  values?: ReportValues;
  error?: string;
  sent?: { replyTo: boolean };
  notice?: string;
}> = ({ slug, title, attemptId, company, values, error, sent, notice }) => (
  <Layout title={`Report a problem with ${company}`}>
    <div class="prose">
      <p class="crumbs">
        <a href={`/t/${slug}`}>{title}</a>
      </p>
      <div id="report-slot">
        {notice ? (
          <p>{notice}</p>
        ) : sent ? (
          <ReportThanks company={company} replyTo={sent.replyTo} />
        ) : (
          <ReportForm slug={slug} attemptId={attemptId} company={company} values={values} error={error} />
        )}
      </div>
    </div>
  </Layout>
);

// ---------- Admin queue ----------

const VERDICTS: Record<NonNullable<Triage['verdict']>, string> = {
  likely_valid: 'Report looks valid',
  likely_abuse: 'Report looks like abuse',
  unclear: 'Unclear',
};

const TriageView: FC<{ t: Triage | null }> = ({ t }) => {
  if (!t) return <p class="hint">Checking the source…</p>;
  const source =
    t.source_status === 'ok'
      ? `Source loads${t.source_http ? ` (HTTP ${t.source_http})` : ''}.`
      : t.source_status === 'missing'
        ? 'No source link. An unsourced claim about a named company is a risk: add a source or remove it.'
        : t.source_status === 'unreachable'
          ? `Source didn't load${t.source_http ? ` (HTTP ${t.source_http})` : ''}. Find a working source or remove it.`
          : 'Source not checked automatically.';
  const suggestion = [
    t.suggested_outcome && `Outcome: “${t.suggested_outcome}”`,
    t.suggested_notes && `Note: “${t.suggested_notes}”`,
  ].filter(Boolean);
  return (
    <div class="triage">
      <p>{source}</p>
      {t.verdict && (
        <p>
          <strong>AI check (advisory): {VERDICTS[t.verdict]}.</strong>{' '}
          {t.source_supports_claim === true && 'The source supports the listing. '}
          {t.source_supports_claim === false && "The source doesn't match the listing. "}
          {t.summary}
        </p>
      )}
      {suggestion.length > 0 && <p>Suggested wording: {suggestion.join('. ')}.</p>}
      {t.error && <p class="hint">Check failed: {t.error}</p>}
    </div>
  );
};

export const ReportedCompanyCard: FC<{ r: ReportedCompany; error?: string; values?: SuggestionValues }> = ({
  r,
  error,
  values,
}) => {
  const id = r.attempt_id;
  const v: SuggestionValues = values ?? {
    company: r.company,
    start_year: r.start_year ? String(r.start_year) : '',
    end_year: r.end_year ? String(r.end_year) : '',
    outcome: r.outcome,
    notes: r.notes,
    source_url: r.source_url ?? '',
  };
  const target = `#rp${id}`;
  return (
    <li class="suggestion report-card" id={`rp${id}`}>
      <p class="suggestion-head">
        {r.company} ({yearSpan(r)}) on <a href={`/t/${r.slug}`}>{r.title}</a>
      </p>
      {r.hidden_at ? (
        <p class="hint">Hidden from the page since {formatDate(r.hidden_at)}.</p>
      ) : (
        <p class="dupe">Still listed: the hourly auto-hide limit was reached when this was reported.</p>
      )}
      <ol class="report-list">
        {r.reports.map((rep) => (
          <li>
            <p>
              <strong>{REPORT_REASONS[rep.reason]}</strong>, {formatDate(rep.created_at)}
              {rep.reporter_email ? (
                <>
                  , from <a href={`mailto:${rep.reporter_email}`}>{rep.reporter_email}</a>
                </>
              ) : (
                ', no email given'
              )}
            </p>
            <p class="admin-body">{rep.details}</p>
            <TriageView t={rep.triage} />
          </li>
        ))}
      </ol>
      {r.source_url && (
        <p>
          Source:{' '}
          <a href={r.source_url} target="_blank" rel="noopener noreferrer nofollow">
            {r.source_url}
          </a>
        </p>
      )}
      <form class="suggest-form review-form">
        <SuggestionFields v={v} prefix={`rp${id}`} requireSource={false} />
        <p class="form-error" id={`rp-error-${id}`} role="alert">
          {error ?? ''}
        </p>
        <div class="form-actions">
          <button type="button" hx-post={`/admin/reported/${id}/save`} hx-target={target} hx-swap="outerHTML">
            Save and restore
          </button>
          <button
            type="button"
            class="secondary"
            hx-post={`/admin/reported/${id}/restore`}
            hx-target={target}
            hx-swap="outerHTML"
          >
            Restore as it was
          </button>
          {!r.hidden_at && (
            <button
              type="button"
              class="secondary"
              hx-post={`/admin/reported/${id}/hide`}
              hx-target={target}
              hx-swap="outerHTML"
            >
              Hide while I check
            </button>
          )}
          <button
            type="button"
            class="secondary"
            hx-post={`/admin/reported/${id}/remove`}
            hx-target={target}
            hx-swap="outerHTML"
            hx-confirm={`Remove ${r.company} from ${r.title}? This deletes it.`}
          >
            Remove company
          </button>
        </div>
      </form>
    </li>
  );
};

export const ReviewedReport: FC<{ attemptId: number; message: string; slug?: string }> = ({
  attemptId,
  message,
  slug,
}) => (
  <li class="suggestion reviewed" id={`rp${attemptId}`}>
    <p>
      {message} {slug && <a href={`/t/${slug}`}>View entry</a>}
    </p>
  </li>
);

export const ReportedCommentCard: FC<{ r: ReportedComment }> = ({ r }) => {
  const id = r.comment_id;
  const target = `#crp${id}`;
  return (
    <li class="suggestion report-card" id={`crp${id}`}>
      <p class="suggestion-head">
        Comment by {r.author_name} on <a href={`/t/${r.slug}#comments`}>{r.title}</a>, {formatDate(r.created_at)}
      </p>
      <blockquote class="admin-body reported-comment">{r.body}</blockquote>
      {r.hidden ? (
        <p class="hint">Hidden from the page.</p>
      ) : (
        <p class="dupe">Still visible: the hourly auto-hide limit was reached when this was reported.</p>
      )}
      <ol class="report-list">
        {r.reports.map((rep) => (
          <li>
            <p>
              <strong>{COMMENT_REPORT_REASONS[rep.reason]}</strong>, {formatDate(rep.created_at)}
              {rep.reporter_email ? (
                <>
                  , from <a href={`mailto:${rep.reporter_email}`}>{rep.reporter_email}</a>
                </>
              ) : (
                ', no email given'
              )}
            </p>
            {rep.details && <p class="admin-body">{rep.details}</p>}
          </li>
        ))}
      </ol>
      <div class="form-actions">
        <button hx-post={`/admin/reported-comments/${id}/restore`} hx-target={target} hx-swap="outerHTML">
          Show it again
        </button>
        {!r.hidden && (
          <button
            class="secondary"
            hx-post={`/admin/reported-comments/${id}/hide`}
            hx-target={target}
            hx-swap="outerHTML"
          >
            Hide while I check
          </button>
        )}
        <button
          class="secondary"
          hx-post={`/admin/reported-comments/${id}/remove`}
          hx-target={target}
          hx-swap="outerHTML"
        >
          Keep it hidden
        </button>
      </div>
    </li>
  );
};

export const ReviewedCommentReport: FC<{ commentId: number; message: string; slug?: string }> = ({
  commentId,
  message,
  slug,
}) => (
  <li class="suggestion reviewed" id={`crp${commentId}`}>
    <p>
      {message} {slug && <a href={`/t/${slug}#comments`}>View comments</a>}
    </p>
  </li>
);
