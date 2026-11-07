import type { FC } from 'hono/jsx';
import type { EditableAttempt, EditableReason, EditableSource, EntryEditor, EntryValues } from '../admin-data.js';
import type { SuggestionValues } from '../suggestions.js';
import { TAGS } from '../tags.js';
import { VERDICTS } from '../verdicts.js';
import { Layout } from './layout.js';
import { OutcomeOptions, SuggestionFields } from './suggest.js';

// The admin entry editor. Each company, reason and source is its own small htmx form, so
// saving one row never touches the others.

/** Clears an "add" form after a successful post, but not when the server retargeted an error. */
const RESET_ON_SUCCESS = 'if (event.detail.successful && !event.detail.xhr.getResponseHeader("HX-Retarget")) this.reset()';

export function attemptValues(a: EditableAttempt): SuggestionValues {
  return {
    company: a.company,
    start_year: a.start_year ? String(a.start_year) : '',
    end_year: a.end_year ? String(a.end_year) : '',
    outcome: a.outcome,
    notes: a.notes,
    source_url: a.source_url ?? '',
    state: a.state,
  };
}

const RowMessage: FC<{ msg?: string; error?: string }> = ({ msg, error }) =>
  error ? (
    <p class="form-error" role="alert">
      {error}
    </p>
  ) : msg ? (
    <p class="saved" role="status">
      {msg}
    </p>
  ) : null;

// ---------- Rows ----------

export const AttemptEditRow: FC<{
  id: number;
  v: SuggestionValues;
  suggestedBy?: string | null;
  hidden?: boolean;
  msg?: string;
  error?: string;
}> = ({ id, v, suggestedBy, hidden, msg, error }) => (
  <form class="edit-row" id={`att${id}`} hx-post={`/admin/attempts/${id}`} hx-target="this" hx-swap="outerHTML">
    {suggestedBy && <p class="hint">Suggested by {suggestedBy}</p>}
    {hidden && (
      <p class="dupe">
        Hidden while a report is reviewed. Restore or remove it under <a href="/admin#reports">Reported companies</a>.
      </p>
    )}
    <SuggestionFields v={v} prefix={`att${id}`} requireSource={false} showState />
    <RowMessage msg={msg} error={error} />
    <div class="form-actions">
      <button type="submit">Save company</button>
      <button
        type="button"
        class="secondary"
        hx-post={`/admin/attempts/${id}/delete`}
        hx-target="closest form"
        hx-swap="outerHTML"
        hx-confirm={`Remove ${v.company || 'this company'}?`}
      >
        Remove
      </button>
    </div>
  </form>
);

const TagSelect: FC<{ value?: string }> = ({ value }) => (
  <select name="tag" required>
    <option value="">Choose a reason</option>
    {Object.entries(TAGS).map(([key, t]) => (
      <option value={key} selected={key === value}>
        {t.label}
      </option>
    ))}
  </select>
);

export const ReasonEditRow: FC<{ r: EditableReason; msg?: string; error?: string }> = ({ r, msg, error }) => (
  <form class="edit-row edit-row-inline" id={`rsn${r.id}`} hx-post={`/admin/reasons/${r.id}`} hx-target="this" hx-swap="outerHTML">
    <TagSelect value={r.tag} />
    <input type="text" name="detail" required maxlength={300} value={r.detail} aria-label="Explanation" />
    <div class="form-actions">
      <button type="submit">Save</button>
      <button
        type="button"
        class="secondary"
        hx-post={`/admin/reasons/${r.id}/delete`}
        hx-target="closest form"
        hx-swap="outerHTML"
        hx-confirm="Remove this reason?"
      >
        Remove
      </button>
    </div>
    <RowMessage msg={msg} error={error} />
  </form>
);

export const SourceEditRow: FC<{ s: EditableSource; msg?: string; error?: string }> = ({ s, msg, error }) => (
  <form class="edit-row edit-row-inline" id={`src${s.id}`} hx-post={`/admin/sources/${s.id}`} hx-target="this" hx-swap="outerHTML">
    <input type="text" name="title" required maxlength={200} value={s.title} aria-label="Title" />
    <input type="url" name="url" required maxlength={500} value={s.url} aria-label="Link" />
    <div class="form-actions">
      <button type="submit">Save</button>
      <button
        type="button"
        class="secondary"
        hx-post={`/admin/sources/${s.id}/delete`}
        hx-target="closest form"
        hx-swap="outerHTML"
        hx-confirm="Remove this source?"
      >
        Remove
      </button>
    </div>
    <RowMessage msg={msg} error={error} />
  </form>
);

// ---------- Entry text ----------

const EntryFields: FC<{ v: EntryValues; categories: string[] }> = ({ v, categories }) => (
  <>
    <label for="e-title">Title</label>
    <input id="e-title" type="text" name="title" required maxlength={120} value={v.title ?? ''} />
    <label for="e-slug">URL name</label>
    <input id="e-slug" type="text" name="slug" maxlength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={v.slug ?? ''} placeholder="Made from the title if left empty" />
    <p class="hint">Changing this changes the page address, so old links stop working.</p>
    <label for="e-category">Category</label>
    <input id="e-category" type="text" name="category" required maxlength={40} list="category-options" value={v.category ?? ''} />
    <datalist id="category-options">
      {categories.map((c) => (
        <option value={c} />
      ))}
    </datalist>
    <label for="e-summary">One-sentence summary</label>
    <input id="e-summary" type="text" name="summary" required maxlength={300} value={v.summary ?? ''} />
    <label for="e-tempting">Why it looks easy</label>
    <textarea id="e-tempting" name="why_tempting" rows={5} maxlength={6000}>
      {v.why_tempting ?? ''}
    </textarea>
    <label for="e-verdict">Verdict</label>
    <select id="e-verdict" name="verdict">
      {Object.entries(VERDICTS).map(([key, d]) => (
        <option value={key} selected={(v.verdict ?? 'tarpit') === key}>
          {d.label}: {d.description}
        </option>
      ))}
    </select>
    <p class="hint">
      Your call, shown as a badge and kept separate from the visitors' vote. For a cracked entry the page headings
      become "Why it used to fail" and "What changed", so write those two sections that way.
    </p>
    <label for="e-fails">Why it keeps failing</label>
    <textarea id="e-fails" name="why_it_fails" rows={6} maxlength={6000}>
      {v.why_it_fails ?? ''}
    </textarea>
    <label for="e-change">What would have to be true now</label>
    <textarea id="e-change" name="what_would_change" rows={5} maxlength={6000}>
      {v.what_would_change ?? ''}
    </textarea>
    <p class="hint">Leave a blank line between paragraphs.</p>
    <label for="e-keywords">Search keywords</label>
    <input id="e-keywords" type="text" name="keywords" maxlength={300} value={v.keywords ?? ''} placeholder="comma separated, e.g. grocery delivery, dark stores" />
    <label class="check">
      <input type="checkbox" name="status" value="reviewed" checked={v.status === 'reviewed'} />
      Reviewed: the facts on this page have been checked against sources
    </label>
  </>
);

export function entryValues(t: EntryEditor['tarpit']): EntryValues {
  const { id: _id, ...rest } = t;
  return rest;
}

// ---------- Pages ----------

export const NewEntryPage: FC<{ categories: string[]; values?: EntryValues; error?: string }> = ({
  categories,
  values = {},
  error,
}) => (
  <Layout title="New entry">
    <div class="admin admin-edit">
      <p class="crumbs">
        <a href="/admin">Admin</a>
      </p>
      <h1>New entry</h1>
      <p class="hint">Start with the text. You can add companies, reasons and sources after you create it.</p>
      <form class="edit-form" method="post" action="/admin/tarpits">
        <EntryFields v={values} categories={categories} />
        {error && (
          <p class="form-error" role="alert">
            {error}
          </p>
        )}
        <div class="form-actions">
          <button type="submit">Create entry</button>
          <a href="/admin">Cancel</a>
        </div>
      </form>
    </div>
  </Layout>
);

export const EditEntryPage: FC<{ editor: EntryEditor; categories: string[] }> = ({ editor, categories }) => {
  const { tarpit: t, attempts, reasons, sources } = editor;
  return (
    <Layout title={`Edit ${t.title}`}>
      <div class="admin admin-edit">
        <p class="crumbs">
          <a href="/admin">Admin</a> / <a href={`/t/${t.slug}`}>View on site</a>
        </p>
        <h1>{t.title}</h1>

        <section>
          <h2>Text</h2>
          <form class="edit-form" hx-post={`/admin/tarpits/${t.id}`} hx-target="#entry-msg" hx-swap="innerHTML">
            <EntryFields v={entryValues(t)} categories={categories} />
            <div class="form-actions">
              <button type="submit">Save text</button>
              <span id="entry-msg" role="status"></span>
            </div>
          </form>
        </section>

        <section>
          <h2>
            Companies ({attempts.filter((a) => a.state === 'ended').length} who tried,{' '}
            {attempts.filter((a) => a.state === 'active').length} still operating)
          </h2>
          <p class="hint">
            Shown newest first on the page. Companies approved from visitor suggestions are listed here too. "Still
            operating" means still doing this idea today; a company that pivoted away counts as ended. Only list a live
            company that has launched and has been covered by someone other than itself, and describe it with facts
            only.
          </p>
          <OutcomeOptions />
          <div class="edit-list" id="attempt-list">
            {attempts.map((a) => (
              <AttemptEditRow id={a.id} v={attemptValues(a)} suggestedBy={a.suggested_by} hidden={!!a.hidden_at} />
            ))}
          </div>
          <h3>Add a company</h3>
          <form
            class="edit-row add-row"
            hx-post={`/admin/tarpits/${t.id}/attempts`}
            hx-target="#attempt-list"
            hx-swap="beforeend"
            hx-on--after-request={RESET_ON_SUCCESS}
          >
            <SuggestionFields v={{}} prefix="new-att" requireSource={false} showState />
            <p class="form-error" id="attempt-add-msg" role="alert"></p>
            <div class="form-actions">
              <button type="submit">Add company</button>
            </div>
          </form>
        </section>

        <section>
          <h2>Why it keeps failing: reasons</h2>
          <p class="hint">Each reason shows as a labelled line on the page and drives the idea checker's questions.</p>
          <div class="edit-list" id="reason-list">
            {reasons.map((r) => (
              <ReasonEditRow r={r} />
            ))}
          </div>
          <form
            class="edit-row edit-row-inline add-row"
            hx-post={`/admin/tarpits/${t.id}/reasons`}
            hx-target="#reason-list"
            hx-swap="beforeend"
            hx-on--after-request={RESET_ON_SUCCESS}
          >
            <TagSelect />
            <input type="text" name="detail" required maxlength={300} placeholder="Why this applies here" aria-label="Explanation" />
            <div class="form-actions">
              <button type="submit">Add reason</button>
            </div>
            <p class="form-error" id="reason-add-msg" role="alert"></p>
          </form>
        </section>

        <section>
          <h2>Sources</h2>
          <div class="edit-list" id="source-list">
            {sources.map((s) => (
              <SourceEditRow s={s} />
            ))}
          </div>
          <form
            class="edit-row edit-row-inline add-row"
            hx-post={`/admin/tarpits/${t.id}/sources`}
            hx-target="#source-list"
            hx-swap="beforeend"
            hx-on--after-request={RESET_ON_SUCCESS}
          >
            <input type="text" name="title" required maxlength={200} placeholder="Title, e.g. Webvan (Wikipedia)" aria-label="Title" />
            <input type="url" name="url" required maxlength={500} placeholder="https://" aria-label="Link" />
            <div class="form-actions">
              <button type="submit">Add source</button>
            </div>
            <p class="form-error" id="source-add-msg" role="alert"></p>
          </form>
        </section>

        <section class="danger">
          <h2>Delete this entry</h2>
          <p class="hint">Removes the entry with all its companies, reasons, sources, comments and votes. This can't be undone.</p>
          <button
            type="button"
            class="danger-button"
            hx-post={`/admin/tarpits/${t.id}/delete`}
            hx-confirm={`Delete "${t.title}" and everything on it? This can't be undone.`}
          >
            Delete entry
          </button>
        </section>
      </div>
    </Layout>
  );
};
