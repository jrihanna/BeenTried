import './env.js';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { basicAuth } from 'hono/basic-auth';
import { getCookie, setCookie } from 'hono/cookie';
import { csrf } from 'hono/csrf';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { aiEnabled } from './ai.js';
import { checkIdea } from './check.js';
import {
  addAttempt,
  addReason,
  addSource,
  createEntry,
  deleteAttempt,
  deleteEntry,
  deleteReason,
  deleteSource,
  getEntryEditor,
  parseEntry,
  parseReason,
  parseSource,
  slugTaken,
  updateAttempt,
  updateEntry,
  updateReason,
  updateSource,
} from './admin-data.js';
import { importContent, isEmpty, refreshEmbedding } from './content.js';
import {
  addComment,
  adminListComments,
  adminRecentChecks,
  adminToggleComment,
  adminNeedsChecking,
  adminToggleStatus,
  castVote,
  draftsArePublic,
  getComment,
  getComments,
  getTarpit,
  getVotes,
  listCategories,
  listTarpits,
} from './data.js';
import { getDb } from './db.js';
import { allow } from './rate-limit.js';
import {
  AUTOHIDE_PER_HOUR,
  COMMENT_REPORT_REASONS,
  complaintsEmail,
  createCommentReport,
  createReport,
  getReportableAttempt,
  getReportableComment,
  hideReported,
  hideReportedComment,
  listReportedComments,
  listReportedCompanies,
  parseReport,
  processCommentReport,
  processReport,
  removeAttempt,
  REPORT_REASONS,
  reportValues,
  resolveReportedComment,
  restoreReported,
} from './reports.js';
import {
  approveSuggestion,
  createSuggestion,
  findDuplicate,
  formValues,
  listCommunityAttempts,
  listPendingSuggestions,
  parseSuggestion,
  rejectSuggestion,
} from './suggestions.js';
import { AdminCommentRow, AdminPage, AdminTarpitRow } from './views/admin.js';
import {
  AttemptEditRow,
  attemptValues,
  EditEntryPage,
  NewEntryPage,
  ReasonEditRow,
  SourceEditRow,
} from './views/admin-edit.js';
import { AboutPage, CheckPage, CheckResultView, HomePage, NotFoundPage, PrivacyPage, TarpitPage, TermsPage } from './views/pages.js';
import { CommentForm, CommentItem, VoteBox } from './views/parts.js';
import {
  attemptReportErrorId,
  CommentReportForm,
  CommentReportPage,
  CommentReportThanks,
  commentReportErrorId,
  ReportedCommentCard,
  ReportedCompanyCard,
  ReportForm,
  ReportPage,
  ReportThanks,
  ReviewedCommentReport,
  ReviewedReport,
} from './views/report.js';
import {
  ReviewedSuggestion,
  SuggestForm,
  SuggestLink,
  SuggestPage,
  SuggestThanks,
} from './views/suggest.js';

const SECRET = process.env.SESSION_SECRET || 'dev-secret';
if (process.env.NODE_ENV === 'production' && SECRET === 'dev-secret') {
  console.warn('SESSION_SECRET is not set. Set it to a long random string in production.');
}

const hash = (value: string) => createHash('sha256').update(`${SECRET}:${value}`).digest('hex').slice(0, 32);

type Env = { Variables: { visitor: string; ipHash: string } };
const app = new Hono<Env>();

app.use(logger());
app.use(secureHeaders());
// Rejects cross-site form posts. Behind a proxy, set PUBLIC_URL so the expected origin is right.
app.use(csrf(process.env.PUBLIC_URL ? { origin: process.env.PUBLIC_URL.replace(/\/$/, '') } : undefined));

// Every visitor gets an anonymous id cookie, used for one-vote-per-person.
app.use(async (c, next) => {
  let vid = getCookie(c, 'vid');
  if (!vid || !/^[0-9a-f-]{36}$/.test(vid)) {
    vid = randomUUID();
    setCookie(c, 'vid', vid, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });
  }
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  let ip = forwarded || 'unknown';
  if (!forwarded) {
    try {
      ip = getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      // Not running on the Node adapter (e.g. in tests).
    }
  }
  c.set('visitor', hash(`v:${vid}`));
  c.set('ipHash', hash(`ip:${ip}`));
  await next();
});

// ---------- Static assets ----------

app.use(
  '/static/*',
  serveStatic({ root: './public', rewriteRequestPath: (p) => p.replace(/^\/static/, '') }),
);

const htmxSource = readFileSync(join(process.cwd(), 'node_modules/htmx.org/dist/htmx.min.js'), 'utf8');
app.get('/vendor/htmx.min.js', (c) => {
  c.header('content-type', 'text/javascript; charset=utf-8');
  c.header('cache-control', 'public, max-age=86400');
  return c.body(htmxSource);
});

// ---------- Pages ----------

const isHtmx = (c: Context) => c.req.header('HX-Request') === 'true';

app.get('/', async (c) => {
  const q = c.req.query('q')?.slice(0, 200);
  const category = c.req.query('category')?.slice(0, 100);
  const [tarpits, categories] = await Promise.all([listTarpits({ q, category }), listCategories()]);
  const totalAttempts = tarpits.reduce((sum, t) => sum + t.attempt_count, 0);
  return c.html(
    <HomePage tarpits={tarpits} categories={categories} q={q} category={category} totalAttempts={totalAttempts} />,
  );
});

app.get('/t/:slug', async (c) => {
  const tarpit = await getTarpit(c.req.param('slug'));
  if (!tarpit) return c.notFound();
  const [comments, tally] = await Promise.all([getComments(tarpit.id), getVotes(tarpit.id, c.get('visitor'))]);
  return c.html(<TarpitPage tarpit={tarpit} comments={comments} tally={tally} />);
});

app.get('/about', (c) => c.html(<AboutPage />));

app.get('/privacy', (c) => c.html(<PrivacyPage aiOn={aiEnabled()} />));

app.get('/terms', (c) => c.html(<TermsPage aiOn={aiEnabled()} />));

app.get('/check', (c) => c.html(<CheckPage aiOn={aiEnabled()} />));

// ---------- Actions ----------

/** Sends a validation message into the form's error slot instead of swapping content. */
function formError(c: Context, targetId: string, message: string) {
  if (!isHtmx(c)) return c.text(message, 400);
  c.header('HX-Retarget', `#${targetId}`);
  c.header('HX-Reswap', 'innerHTML');
  return c.text(message);
}

app.post('/t/:slug/comments', async (c) => {
  const slug = c.req.param('slug');
  const tarpit = await getTarpit(slug);
  if (!tarpit) return c.notFound();

  const form = await c.req.parseBody();
  const field = (name: string) => (typeof form[name] === 'string' ? (form[name] as string).trim() : '');
  const parentRaw = field('parent_id');
  const parentId = parentRaw ? Number.parseInt(parentRaw, 10) : null;
  const errorId = parentId ? `comment-error-${parentId}` : 'comment-error';

  // Honeypot: real people never fill the hidden "website" field. Pretend it worked.
  if (field('website')) return isHtmx(c) ? c.body(null, 204) : c.redirect(`/t/${slug}#comments`);

  const authorName = field('author_name');
  const body = field('body');
  if (!authorName || authorName.length > 60) return formError(c, errorId, 'Add a name of up to 60 characters.');
  if (body.length < 3 || body.length > 4000) return formError(c, errorId, 'Comments need between 3 and 4,000 characters.');
  if (!allow(`comment:${c.get('ipHash')}`, 8, 10 * 60 * 1000)) {
    return formError(c, errorId, "You've posted a lot in the last few minutes. Wait a bit and try again.");
  }

  if (parentId !== null) {
    const parent = Number.isFinite(parentId) ? await getComment(parentId) : null;
    if (!parent || parent.tarpit_id !== tarpit.id) return formError(c, errorId, 'That comment no longer exists.');
  }

  const comment = await addComment({ tarpitId: tarpit.id, parentId, authorName, body, ipHash: c.get('ipHash') });
  if (!isHtmx(c)) return c.redirect(`/t/${slug}#c${comment.id}`);

  return c.html(
    <>
      <CommentItem slug={slug} comment={comment} depth={parentId ? 1 : 0} />
      {!parentId && <p id="no-comments" hx-swap-oob="delete"></p>}
    </>,
  );
});

app.get('/t/:slug/comments/:id/reply', (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.notFound();
  return c.html(<CommentForm slug={c.req.param('slug')} parentId={id} />);
});

app.post('/t/:slug/vote', async (c) => {
  const slug = c.req.param('slug');
  const tarpit = await getTarpit(slug);
  if (!tarpit) return c.notFound();
  const form = await c.req.parseBody();
  const verdict = form.verdict;
  if ((verdict === 'still' || verdict === 'cracked') && allow(`vote:${c.get('ipHash')}`, 40, 10 * 60 * 1000)) {
    await castVote(tarpit.id, c.get('visitor'), verdict);
  }
  if (!isHtmx(c)) return c.redirect(`/t/${slug}#vote`);
  const tally = await getVotes(tarpit.id, c.get('visitor'));
  return c.html(<VoteBox slug={slug} tally={tally} />);
});

// ---------- Company suggestions ----------

app.get('/t/:slug/suggest', async (c) => {
  const tarpit = await getTarpit(c.req.param('slug'));
  if (!tarpit) return c.notFound();
  if (isHtmx(c)) return c.html(<SuggestForm slug={tarpit.slug} />);
  return c.html(<SuggestPage slug={tarpit.slug} title={tarpit.title} />);
});

app.get('/t/:slug/suggest/cancel', (c) => c.html(<SuggestLink slug={c.req.param('slug')} />));

app.post('/t/:slug/suggest', async (c) => {
  const tarpit = await getTarpit(c.req.param('slug'));
  if (!tarpit) return c.notFound();
  const form = await c.req.parseBody();
  const parsed = parseSuggestion(form);

  const showError = (error: string) => {
    if (isHtmx(c)) {
      c.header('HX-Retarget', '#suggest-error');
      c.header('HX-Reswap', 'innerHTML');
      return c.text(error);
    }
    return c.html(
      <SuggestPage slug={tarpit.slug} title={tarpit.title} values={formValues(form)} error={error} />,
      400,
    );
  };
  const showThanks = (company: string) =>
    isHtmx(c)
      ? c.html(<SuggestThanks slug={tarpit.slug} company={company} />)
      : c.html(<SuggestPage slug={tarpit.slug} title={tarpit.title} sent={company} />);

  // Honeypot: pretend it worked so bots don't learn anything.
  if (typeof form.website === 'string' && form.website.trim()) return showThanks('Your suggestion');
  if (!parsed.ok) return showError(parsed.error);
  if (!allow(`suggest:${c.get('ipHash')}`, 5, 60 * 60 * 1000)) {
    return showError("You've sent several suggestions this hour. Try again later.");
  }

  const duplicate = await findDuplicate(tarpit.id, parsed.value.company);
  if (duplicate === 'listed') return showError(`${parsed.value.company} is already listed on this entry.`);
  if (duplicate === 'pending') return showError(`Someone has already suggested ${parsed.value.company}. It's waiting to be checked.`);

  await createSuggestion(tarpit.id, parsed.value, c.get('ipHash'));
  return showThanks(parsed.value.company);
});

// ---------- Reports on "Who tried" ----------
// A report hides the company straight away (in the same statement that records it). The source
// check and AI notes run afterwards and are advisory; only an admin can restore or remove.

const HOUR = 60 * 60 * 1000;

app.get('/t/:slug/attempts/:id{[0-9]+}/report', async (c) => {
  const tarpit = await getTarpit(c.req.param('slug'));
  if (!tarpit) return c.notFound();
  const attempt = await getReportableAttempt(tarpit.id, Number(c.req.param('id')));
  if (!attempt) return c.notFound();
  const props = { slug: tarpit.slug, attemptId: attempt.id, company: attempt.company };
  if (attempt.hidden_at) {
    const notice = `${attempt.company} is already hidden while a report is checked.`;
    return isHtmx(c) ? c.html(<p class="hint">{notice}</p>) : c.html(<ReportPage {...props} title={tarpit.title} notice={notice} />);
  }
  if (isHtmx(c)) return c.html(<ReportForm {...props} />);
  return c.html(<ReportPage {...props} title={tarpit.title} />);
});

app.get('/t/:slug/report/cancel', (c) => c.html(''));

app.post('/t/:slug/attempts/:id{[0-9]+}/report', async (c) => {
  const tarpit = await getTarpit(c.req.param('slug'));
  if (!tarpit) return c.notFound();
  const attempt = await getReportableAttempt(tarpit.id, Number(c.req.param('id')));
  if (!attempt) return c.notFound();
  const form = await c.req.parseBody();
  const props = { slug: tarpit.slug, title: tarpit.title, attemptId: attempt.id, company: attempt.company };

  const showError = (error: string) => {
    if (isHtmx(c)) {
      c.header('HX-Retarget', `#${attemptReportErrorId()}`);
      c.header('HX-Reswap', 'innerHTML');
      return c.text(error);
    }
    return c.html(<ReportPage {...props} values={reportValues(form)} error={error} />, 400);
  };
  const showThanks = (replyTo: boolean) =>
    isHtmx(c)
      ? c.html(
          <>
            <ReportThanks company={attempt.company} replyTo={replyTo} />
            <li id={`layer-${attempt.id}`} hx-swap-oob="delete"></li>
          </>,
        )
      : c.html(<ReportPage {...props} sent={{ replyTo }} />);

  // Honeypot: pretend it worked.
  if (typeof form.website === 'string' && form.website.trim()) return showThanks(false);
  const parsed = parseReport(form, REPORT_REASONS);
  if (!parsed.ok) return showError(parsed.error);
  if (!allow(`report:${c.get('ipHash')}`, 5, HOUR)) {
    return showError("You've sent several reports this hour. Try again later.");
  }

  // Site-wide brake: past the hourly limit, reports still queue for review but stop hiding,
  // so one person rotating IPs can't empty every entry.
  const hide = !attempt.hidden_at && allow('report-autohide', AUTOHIDE_PER_HOUR, HOUR);
  const reportId = await createReport(attempt.id, parsed.value, c.get('ipHash'), hide);
  if (reportId) void processReport(reportId).catch((err) => console.error(`Report #${reportId} check failed:`, err));
  return showThanks(Boolean(parsed.value.email));
});

// Comment reports work the same way: hidden on report, reviewed in /admin.

app.get('/t/:slug/comments/:id{[0-9]+}/report', async (c) => {
  const tarpit = await getTarpit(c.req.param('slug'));
  if (!tarpit) return c.notFound();
  const comment = await getReportableComment(tarpit.id, Number(c.req.param('id')));
  if (!comment) return c.notFound();
  const props = { slug: tarpit.slug, commentId: comment.id, author: comment.author_name };
  if (comment.hidden) {
    const notice = 'This comment is already hidden.';
    return isHtmx(c)
      ? c.html(<p class="hint">{notice}</p>)
      : c.html(<CommentReportPage {...props} title={tarpit.title} notice={notice} />);
  }
  if (isHtmx(c)) return c.html(<CommentReportForm {...props} />);
  return c.html(<CommentReportPage {...props} title={tarpit.title} />);
});

app.post('/t/:slug/comments/:id{[0-9]+}/report', async (c) => {
  const tarpit = await getTarpit(c.req.param('slug'));
  if (!tarpit) return c.notFound();
  const comment = await getReportableComment(tarpit.id, Number(c.req.param('id')));
  if (!comment) return c.notFound();
  const form = await c.req.parseBody();
  const props = { slug: tarpit.slug, title: tarpit.title, commentId: comment.id, author: comment.author_name };

  const showError = (error: string) => {
    if (isHtmx(c)) {
      c.header('HX-Retarget', `#${commentReportErrorId(comment.id)}`);
      c.header('HX-Reswap', 'innerHTML');
      return c.text(error);
    }
    return c.html(<CommentReportPage {...props} values={reportValues(form)} error={error} />, 400);
  };
  // The thanks message replaces the form, and the comment body is swapped out of the page.
  const showThanks = (replyTo: boolean) =>
    isHtmx(c)
      ? c.html(
          <>
            <CommentReportThanks replyTo={replyTo} />
            <p class="comment-body comment-hidden" id={`cbody-${comment.id}`} hx-swap-oob="true">
              Hidden while a report is checked.
            </p>
          </>,
        )
      : c.html(<CommentReportPage {...props} sent={{ replyTo }} />);

  if (typeof form.website === 'string' && form.website.trim()) return showThanks(false);
  const parsed = parseReport(form, COMMENT_REPORT_REASONS, { requireDetails: false });
  if (!parsed.ok) return showError(parsed.error);
  if (!allow(`report:${c.get('ipHash')}`, 5, HOUR)) {
    return showError("You've sent several reports this hour. Try again later.");
  }
  const hide = !comment.hidden && allow('comment-report-autohide', AUTOHIDE_PER_HOUR, HOUR);
  const reportId = await createCommentReport(comment.id, parsed.value, c.get('ipHash'), hide);
  if (reportId) {
    void processCommentReport(reportId).catch((err) => console.error(`Comment report #${reportId} failed:`, err));
  }
  return showThanks(Boolean(parsed.value.email));
});

app.post('/check', async (c) => {
  const form = await c.req.parseBody();
  const idea = typeof form.idea === 'string' ? form.idea.trim().slice(0, 1500) : '';
  const render = (node: Parameters<typeof c.html>[0]) =>
    isHtmx(c) ? c.html(node) : c.html(<CheckPage aiOn={aiEnabled()} idea={idea} result={node} />);

  if (idea.length < 10) {
    return render(<p class="form-error">Describe your idea in at least a sentence so there's something to match.</p>);
  }
  if (!allow(`check:${c.get('ipHash')}`, 15, 60 * 60 * 1000)) {
    return render(<p class="form-error">You've checked a lot of ideas this hour. Try again later.</p>);
  }
  const result = await checkIdea(idea);
  return render(<CheckResultView result={result} />);
});

// ---------- Admin ----------

const adminPassword = process.env.ADMIN_PASSWORD?.trim();
if (adminPassword) {
  app.use('/admin/*', basicAuth({ username: process.env.ADMIN_USER || 'admin', password: adminPassword }));
  app.use('/admin', basicAuth({ username: process.env.ADMIN_USER || 'admin', password: adminPassword }));

  app.get('/admin', async (c) => {
    const [comments, tarpits, checks, suggestions, community, reports, commentReports, needsChecking] =
      await Promise.all([
        adminListComments(),
        listTarpits({ includeDrafts: true }),
        adminRecentChecks(),
        listPendingSuggestions(),
        listCommunityAttempts(),
        listReportedCompanies(),
        listReportedComments(),
        adminNeedsChecking(),
      ]);
    return c.html(
      <AdminPage
        comments={comments}
        tarpits={tarpits}
        checks={checks}
        suggestions={suggestions}
        community={community}
        reports={reports}
        commentReports={commentReports}
        needsChecking={needsChecking}
        draftsPublic={draftsArePublic()}
      />,
    );
  });

  app.post('/admin/suggestions/:id/approve', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    const parsed = parseSuggestion(await c.req.parseBody());
    if (!parsed.ok) {
      c.header('HX-Retarget', `#sg-error-${id}`);
      c.header('HX-Reswap', 'innerHTML');
      return c.text(parsed.error);
    }
    const done = await approveSuggestion(id, parsed.value);
    if (!done) return c.html(<ReviewedSuggestion id={id} message="This suggestion was already reviewed." />);
    return c.html(
      <ReviewedSuggestion id={id} message={`Approved. ${done.company} now appears on ${done.title}.`} slug={done.slug} />,
    );
  });

  app.post('/admin/suggestions/:id/reject', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10);
    const changed = await rejectSuggestion(id);
    return c.html(<ReviewedSuggestion id={id} message={changed ? 'Rejected.' : 'This suggestion was already reviewed.'} />);
  });

  // Lets you see an unreviewed entry as visitors will, when drafts are hidden from the public.
  app.get('/admin/preview/:slug', async (c) => {
    const tarpit = await getTarpit(c.req.param('slug'), { includeDrafts: true });
    if (!tarpit) return c.notFound();
    const [comments, tally] = await Promise.all([getComments(tarpit.id), getVotes(tarpit.id, c.get('visitor'))]);
    return c.html(<TarpitPage tarpit={tarpit} comments={comments} tally={tally} />);
  });

  // ---------- Reported comments ----------

  const commentParam = (c: Context) => Number.parseInt(c.req.param('id'), 10);
  const commentDone = (c: Context) =>
    c.html(<ReviewedCommentReport commentId={commentParam(c)} message="This comment has no open reports any more." />);

  app.post('/admin/reported-comments/:id{[0-9]+}/restore', async (c) => {
    const done = await resolveReportedComment(commentParam(c), 'restored');
    if (!done) return commentDone(c);
    return c.html(
      <ReviewedCommentReport commentId={commentParam(c)} message={`Shown again: comment by ${done.author_name}.`} slug={done.slug} />,
    );
  });

  app.post('/admin/reported-comments/:id{[0-9]+}/remove', async (c) => {
    const done = await resolveReportedComment(commentParam(c), 'removed');
    if (!done) return commentDone(c);
    return c.html(
      <ReviewedCommentReport commentId={commentParam(c)} message={`Kept hidden: comment by ${done.author_name}.`} slug={done.slug} />,
    );
  });

  app.post('/admin/reported-comments/:id{[0-9]+}/hide', async (c) => {
    await hideReportedComment(commentParam(c));
    const [card] = await listReportedComments(commentParam(c));
    return card ? c.html(<ReportedCommentCard r={card} />) : commentDone(c);
  });

  // ---------- Reported companies ----------

  const attemptParam = (c: Context) => Number.parseInt(c.req.param('id'), 10);
  const alreadyReviewed = (c: Context) =>
    c.html(<ReviewedReport attemptId={attemptParam(c)} message="This company has no open reports any more." />);

  app.post('/admin/reported/:id{[0-9]+}/restore', async (c) => {
    const done = await restoreReported(attemptParam(c), 'restored');
    if (!done) return alreadyReviewed(c);
    return c.html(
      <ReviewedReport attemptId={attemptParam(c)} message={`Restored. ${done.company} is back on ${done.title}.`} slug={done.slug} />,
    );
  });

  app.post('/admin/reported/:id{[0-9]+}/save', async (c) => {
    const attemptId = attemptParam(c);
    const form = await c.req.parseBody();
    const parsed = parseSuggestion(form, { requireSource: false });
    if (!parsed.ok) {
      c.header('HX-Retarget', `#rp-error-${attemptId}`);
      c.header('HX-Reswap', 'innerHTML');
      return c.text(parsed.error);
    }
    if (!(await updateAttempt(attemptId, parsed.value))) return alreadyReviewed(c);
    const done = await restoreReported(attemptId, 'edited');
    if (!done) return alreadyReviewed(c);
    return c.html(
      <ReviewedReport attemptId={attemptId} message={`Saved and restored. ${done.company} is back on ${done.title}.`} slug={done.slug} />,
    );
  });

  app.post('/admin/reported/:id{[0-9]+}/hide', async (c) => {
    await hideReported(attemptParam(c));
    const [card] = await listReportedCompanies(attemptParam(c));
    return card ? c.html(<ReportedCompanyCard r={card} />) : alreadyReviewed(c);
  });

  app.post('/admin/reported/:id{[0-9]+}/remove', async (c) => {
    const done = await removeAttempt(attemptParam(c), 'Removed after a report');
    if (!done) return alreadyReviewed(c);
    return c.html(<ReviewedReport attemptId={attemptParam(c)} message={`Removed ${done.company} from ${done.title}.`} slug={done.slug} />);
  });

  // ---------- Entry editor ----------

  const id = (c: Context, name = 'id') => Number.parseInt(c.req.param(name), 10);
  /** Puts an error message into an "add" form's message slot instead of appending a row. */
  const addError = (c: Context, slot: string, message: string) => {
    c.header('HX-Retarget', `#${slot}`);
    c.header('HX-Reswap', 'innerHTML');
    return c.text(message);
  };
  const reembed = (tarpitId: number) =>
    refreshEmbedding(tarpitId).catch((err) => console.error('Embedding refresh failed:', err));

  app.get('/admin/tarpits/new', async (c) =>
    c.html(<NewEntryPage categories={await listCategories({ includeDrafts: true })} />),
  );

  app.post('/admin/tarpits', async (c) => {
    const parsed = parseEntry(await c.req.parseBody());
    const categories = await listCategories({ includeDrafts: true });
    if (!parsed.ok) return c.html(<NewEntryPage categories={categories} values={parsed.values} error={parsed.error} />, 400);
    if (await slugTaken(parsed.value.slug)) {
      return c.html(
        <NewEntryPage categories={categories} values={parsed.value} error={`Another entry already uses the URL name "${parsed.value.slug}".`} />,
        400,
      );
    }
    const newId = await createEntry(parsed.value);
    await reembed(newId);
    return c.redirect(`/admin/tarpits/${newId}`);
  });

  app.get('/admin/tarpits/:id{[0-9]+}', async (c) => {
    const editor = await getEntryEditor(id(c));
    if (!editor) return c.notFound();
    return c.html(<EditEntryPage editor={editor} categories={await listCategories({ includeDrafts: true })} />);
  });

  app.post('/admin/tarpits/:id{[0-9]+}', async (c) => {
    const parsed = parseEntry(await c.req.parseBody());
    if (!parsed.ok) return c.html(<span class="form-error">{parsed.error}</span>);
    if (await slugTaken(parsed.value.slug, id(c))) {
      return c.html(<span class="form-error">Another entry already uses the URL name "{parsed.value.slug}".</span>);
    }
    await updateEntry(id(c), parsed.value);
    await reembed(id(c));
    return c.html(
      <span class="saved">
        Saved. <a href={`/t/${parsed.value.slug}`}>View on site</a>
      </span>,
    );
  });

  app.post('/admin/tarpits/:id{[0-9]+}/delete', async (c) => {
    await deleteEntry(id(c));
    c.header('HX-Redirect', '/admin');
    return c.body(null, 204);
  });

  // Companies
  app.post('/admin/tarpits/:id{[0-9]+}/attempts', async (c) => {
    const parsed = parseSuggestion(await c.req.parseBody(), { requireSource: false });
    if (!parsed.ok) return addError(c, 'attempt-add-msg', parsed.error);
    const row = await addAttempt(id(c), parsed.value);
    return c.html(<AttemptEditRow id={row.id} v={attemptValues(row)} msg="Added." />);
  });

  app.post('/admin/attempts/:id{[0-9]+}', async (c) => {
    const form = await c.req.parseBody();
    const parsed = parseSuggestion(form, { requireSource: false });
    if (!parsed.ok) return c.html(<AttemptEditRow id={id(c)} v={formValues(form)} error={parsed.error} />);
    const row = await updateAttempt(id(c), parsed.value);
    if (!row) return c.html('');
    return c.html(
      <AttemptEditRow id={row.id} v={attemptValues(row)} suggestedBy={row.suggested_by} hidden={!!row.hidden_at} msg="Saved." />,
    );
  });

  // Also used by the "Companies added by visitors" table. An empty response removes the row.
  app.post('/admin/attempts/:id{[0-9]+}/delete', async (c) => {
    await deleteAttempt(id(c));
    return c.html('');
  });

  // Reasons
  app.post('/admin/tarpits/:id{[0-9]+}/reasons', async (c) => {
    const parsed = parseReason(await c.req.parseBody());
    if (!parsed.ok) return addError(c, 'reason-add-msg', parsed.error);
    const row = await addReason(id(c), parsed.tag, parsed.detail);
    return c.html(<ReasonEditRow r={row} msg="Added." />);
  });

  app.post('/admin/reasons/:id{[0-9]+}', async (c) => {
    const form = await c.req.parseBody();
    const parsed = parseReason(form);
    if (!parsed.ok) {
      const r = { id: id(c), tag: String(form.tag ?? ''), detail: String(form.detail ?? '') };
      return c.html(<ReasonEditRow r={r} error={parsed.error} />);
    }
    const row = await updateReason(id(c), parsed.tag, parsed.detail);
    return row ? c.html(<ReasonEditRow r={row} msg="Saved." />) : c.html('');
  });

  app.post('/admin/reasons/:id{[0-9]+}/delete', async (c) => {
    await deleteReason(id(c));
    return c.html('');
  });

  // Sources
  app.post('/admin/tarpits/:id{[0-9]+}/sources', async (c) => {
    const parsed = parseSource(await c.req.parseBody());
    if (!parsed.ok) return addError(c, 'source-add-msg', parsed.error);
    const row = await addSource(id(c), parsed.title, parsed.url);
    return c.html(<SourceEditRow s={row} msg="Added." />);
  });

  app.post('/admin/sources/:id{[0-9]+}', async (c) => {
    const form = await c.req.parseBody();
    const parsed = parseSource(form);
    if (!parsed.ok) {
      const s = { id: id(c), title: String(form.title ?? ''), url: String(form.url ?? '') };
      return c.html(<SourceEditRow s={s} error={parsed.error} />);
    }
    const row = await updateSource(id(c), parsed.title, parsed.url);
    return row ? c.html(<SourceEditRow s={row} msg="Saved." />) : c.html('');
  });

  app.post('/admin/sources/:id{[0-9]+}/delete', async (c) => {
    await deleteSource(id(c));
    return c.html('');
  });

  app.post('/admin/comments/:id/toggle', async (c) => {
    const row = await adminToggleComment(Number.parseInt(c.req.param('id'), 10));
    // Showing a comment by hand also closes any open reports on it, so the queue doesn't go stale.
    if (row && !row.hidden) await resolveReportedComment(row.id, 'restored');
    return row ? c.html(<AdminCommentRow c={row} />) : c.notFound();
  });

  app.post('/admin/tarpits/:id/toggle', async (c) => {
    const row = await adminToggleStatus(Number.parseInt(c.req.param('id'), 10));
    if (!row) return c.notFound();
    const check = (await adminNeedsChecking()).find((n) => n.id === row.id);
    return c.html(<AdminTarpitRow t={row} unsourced={check?.unsourced} />);
  });
}

// ---------- Errors ----------

app.notFound((c) => c.html(<NotFoundPage />, 404));

app.onError((err, c) => {
  // Middleware such as basicAuth throws HTTPExceptions that carry their own response (the 401
  // with WWW-Authenticate that makes the browser ask for the admin password). Send those as-is.
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.text('Something went wrong on the server. Try again in a moment.', 500);
});

// ---------- Boot ----------

const db = await getDb();
if (await isEmpty()) {
  console.log('Empty database, importing starter content from content/tarpits…');
  await importContent();
}

const port = Number(process.env.PORT) || 3000;
const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`BeenTried running on http://localhost:${port} (${db.kind}${aiEnabled() ? ', AI on' : ', AI off'})`);
  if (!adminPassword) console.log('Admin is off. Set ADMIN_PASSWORD in .env to enable /admin.');
  if (process.env.NODE_ENV === 'production' && !complaintsEmail()) {
    console.warn('COMPLAINTS_EMAIL is not set. Set a complaints contact before launch.');
  }
  console.log(`Unreviewed entries are ${draftsArePublic() ? 'public' : 'hidden from visitors'}.`);
});

const shutdown = async () => {
  server.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { app };
