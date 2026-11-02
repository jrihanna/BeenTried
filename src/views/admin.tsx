import type { FC } from 'hono/jsx';
import type { AdminCheck, AdminComment, NeedsCheck, TarpitSummary } from '../data.js';
import type { ReportedComment, ReportedCompany } from '../reports.js';
import type { CommunityAttempt, PendingSuggestion } from '../suggestions.js';
import { Layout } from './layout.js';
import { formatDate } from './parts.js';
import { ReportedCommentCard, ReportedCompanyCard } from './report.js';
import { CommunityAttemptRow, OutcomeOptions, PendingSuggestionCard } from './suggest.js';

export const AdminCommentRow: FC<{ c: AdminComment }> = ({ c }) => (
  <tr id={`ac${c.id}`} class={c.hidden ? 'is-hidden' : ''}>
    <td>{formatDate(c.created_at)}</td>
    <td>
      <a href={`/t/${c.slug}#c${c.id}`}>{c.title}</a>
    </td>
    <td>{c.author_name}</td>
    <td class="admin-body">{c.body}</td>
    <td>
      <button hx-post={`/admin/comments/${c.id}/toggle`} hx-target={`#ac${c.id}`} hx-swap="outerHTML">
        {c.hidden ? 'Show' : 'Hide'}
      </button>
    </td>
  </tr>
);

export const AdminTarpitRow: FC<{ t: TarpitSummary; unsourced?: string[] }> = ({ t, unsourced = [] }) => (
  <tr id={`at${t.id}`} class={t.status !== 'reviewed' || unsourced.length ? 'needs-check' : ''}>
    <td>
      <a href={`/admin/tarpits/${t.id}`}>{t.title}</a>
    </td>
    <td>{t.attempt_count}</td>
    <td>{t.status === 'reviewed' ? 'Reviewed' : 'Unreviewed'}</td>
    <td>{unsourced.length ? unsourced.join(', ') : ''}</td>
    <td class="row-actions">
      <a href={`/admin/tarpits/${t.id}`}>Edit</a>
      <a href={t.status === 'reviewed' ? `/t/${t.slug}` : `/admin/preview/${t.slug}`}>
        {t.status === 'reviewed' ? 'View' : 'Preview'}
      </a>
      <button hx-post={`/admin/tarpits/${t.id}/toggle`} hx-target={`#at${t.id}`} hx-swap="outerHTML">
        {t.status === 'reviewed' ? 'Mark unreviewed' : 'Mark reviewed'}
      </button>
    </td>
  </tr>
);

export const AdminPage: FC<{
  comments: AdminComment[];
  tarpits: TarpitSummary[];
  checks: AdminCheck[];
  suggestions: PendingSuggestion[];
  community: CommunityAttempt[];
  reports: ReportedCompany[];
  commentReports: ReportedComment[];
  needsChecking: NeedsCheck[];
  draftsPublic: boolean;
}> = ({ comments, tarpits, checks, suggestions, community, reports, commentReports, needsChecking, draftsPublic }) => {
  // Entries needing a check (unreviewed, or a company with no source), keyed by id.
  const unsourcedById = new Map(needsChecking.map((n) => [n.id, n.unsourced]));
  return (
  <Layout title="Admin">
    <div class="admin">
      <h1>Admin</h1>
      <OutcomeOptions />

      <h2 id="reports">Reported companies ({reports.length} waiting)</h2>
      {reports.length === 0 ? (
        <p class="hint">No open reports.</p>
      ) : (
        <>
          <p class="hint">
            A reported company is hidden from its entry until you act. Check the source, then restore it, fix it and
            restore it, or remove it. If the reporter left an email, reply once you've decided.
          </p>
          <ol class="suggestions">
            {reports.map((r) => (
              <ReportedCompanyCard r={r} />
            ))}
          </ol>
        </>
      )}

      <h2 id="comment-reports">Reported comments ({commentReports.length} waiting)</h2>
      {commentReports.length === 0 ? (
        <p class="hint">No open reports.</p>
      ) : (
        <>
          <p class="hint">
            A reported comment is hidden until you act. "Keep it hidden" leaves it off the page for good (its replies
            go with it) without deleting anything.
          </p>
          <ol class="suggestions">
            {commentReports.map((r) => (
              <ReportedCommentCard r={r} />
            ))}
          </ol>
        </>
      )}

      <div class="section-head">
        <h2 id="entries">
          Entries ({tarpits.length}
          {needsChecking.length ? `, ${needsChecking.length} need checking` : ''})
        </h2>
        <a class="button-link" href="/admin/tarpits/new">
          New entry
        </a>
      </div>
      <p class="hint">
        Open an entry to edit its text, companies, reasons and sources. Entries that need checking are listed first.{' '}
        {draftsPublic
          ? 'Unreviewed entries are currently public (PUBLISH_DRAFTS is on, or this is development). '
          : 'Unreviewed entries are hidden from visitors until you mark them reviewed. '}
        Companies without a source are a defamation risk: add a source or remove them.
      </p>
      <table>
        <thead>
          <tr>
            <th>Entry</th>
            <th>Companies</th>
            <th>Status</th>
            <th>Without a source</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {[...tarpits]
            .sort((a, b) => Number(unsourcedById.has(b.id)) - Number(unsourcedById.has(a.id)))
            .map((t) => (
              <AdminTarpitRow t={t} unsourced={unsourcedById.get(t.id)} />
            ))}
        </tbody>
      </table>

      <h2>Suggested companies ({suggestions.length} waiting)</h2>
      {suggestions.length === 0 ? (
        <p class="hint">Nothing to review.</p>
      ) : (
        <>
          <p class="hint">
            Open the source, fix anything that's off, then approve. Approved companies appear on the entry straight
            away.
          </p>
          <ol class="suggestions">
            {suggestions.map((s) => (
              <PendingSuggestionCard s={s} />
            ))}
          </ol>
        </>
      )}

      <h2>Companies added by visitors</h2>
      {community.length === 0 ? (
        <p class="hint">None yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Entry</th>
              <th>Years</th>
              <th>Outcome</th>
              <th>Added by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {community.map((a) => (
              <CommunityAttemptRow a={a} />
            ))}
          </tbody>
        </table>
      )}

      <h2>Recent comments</h2>
      {comments.length === 0 ? (
        <p class="hint">No comments yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Entry</th>
              <th>Name</th>
              <th>Comment</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {comments.map((c) => (
              <AdminCommentRow c={c} />
            ))}
          </tbody>
        </table>
      )}

      <h2>Recent idea checks</h2>
      <p class="hint">Ideas with no match are candidates for new entries.</p>
      {checks.length === 0 ? (
        <p class="hint">Nobody has checked an idea yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Idea</th>
              <th>Matched</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr>
                <td>{formatDate(c.created_at)}</td>
                <td class="admin-body">{c.idea}</td>
                <td>{c.matched_slugs.length ? c.matched_slugs.join(', ') : 'No match'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  </Layout>
  );
};
