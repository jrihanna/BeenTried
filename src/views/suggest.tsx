import type { FC } from 'hono/jsx';
import type { CommunityAttempt, PendingSuggestion, SuggestionValues } from '../suggestions.js';
import { Layout } from './layout.js';
import { formatDate, yearSpan } from './parts.js';

const OUTCOMES = ['Shut down', 'Bankrupt', 'Acquired, then shut down', 'Acquired', 'Pivoted away', 'Faded', 'Still running'];

/** Render once per page; every outcome field points at it. */
export const OutcomeOptions: FC = () => (
  <datalist id="outcome-options">
    {OUTCOMES.map((o) => (
      <option value={o} />
    ))}
  </datalist>
);

/** The link under the strata that opens the suggestion form in place. */
export const SuggestLink: FC<{ slug: string }> = ({ slug }) => (
  <a
    class="suggest-link"
    href={`/t/${slug}/suggest`}
    hx-get={`/t/${slug}/suggest`}
    hx-target="#suggest-slot"
    hx-swap="innerHTML"
  >
    Know another company that tried this? Suggest it
  </a>
);

/**
 * Company fields shared by the public form, the review queue and the entry editor. Admin forms
 * pass showState to choose between "Who tried" and "Still operating"; visitors never see it.
 */
export const SuggestionFields: FC<{ v: SuggestionValues; prefix: string; requireSource?: boolean; showState?: boolean }> = ({
  v,
  prefix,
  requireSource = true,
  showState = false,
}) => {
  const id = (name: string) => `${prefix}-${name}`;
  const thisYear = new Date().getFullYear();
  return (
    <>
      <label for={id('company')}>Company</label>
      <input id={id('company')} type="text" name="company" required maxlength={80} value={v.company ?? ''} />
      <div class="year-pair">
        <span>
          <label for={id('start')}>Started</label>
          <input id={id('start')} type="number" name="start_year" min={1980} max={thisYear} placeholder="2015" value={v.start_year ?? ''} />
        </span>
        <span>
          <label for={id('end')}>Ended</label>
          <input id={id('end')} type="number" name="end_year" min={1980} max={thisYear} placeholder="2019" value={v.end_year ?? ''} />
        </span>
      </div>
      {showState && (
        <>
          <label for={id('state')}>Listed under</label>
          <select id={id('state')} name="state">
            <option value="ended" selected={v.state !== 'active'}>
              Who tried (ended, or no longer doing this)
            </option>
            <option value="active" selected={v.state === 'active'}>
              Still operating (still doing this, including after an acquisition)
            </option>
          </select>
        </>
      )}
      <label for={id('outcome')}>{showState ? 'How it ended, or where it stands' : 'How it ended'}</label>
      <input
        id={id('outcome')}
        type="text"
        name="outcome"
        required
        maxlength={80}
        list="outcome-options"
        placeholder="Shut down"
        value={v.outcome ?? ''}
      />
      <label for={id('notes')}>Short note (optional)</label>
      <input
        id={id('notes')}
        type="text"
        name="notes"
        maxlength={280}
        placeholder="What it offered, or what happened to it"
        value={v.notes ?? ''}
      />
      <label for={id('source')}>{requireSource ? 'Source' : 'Source (optional)'}</label>
      <input
        id={id('source')}
        type="url"
        name="source_url"
        required={requireSource}
        maxlength={500}
        placeholder="https://"
        value={v.source_url ?? ''}
      />
    </>
  );
};

export const SuggestForm: FC<{ slug: string; values?: SuggestionValues; error?: string }> = ({
  slug,
  values = {},
  error,
}) => (
  <form
    class="suggest-form"
    method="post"
    action={`/t/${slug}/suggest`}
    hx-post={`/t/${slug}/suggest`}
    hx-target="#suggest-slot"
    hx-swap="innerHTML"
  >
    <h3>Suggest a company</h3>
    <p class="hint">
      Add a link to a news article, shutdown post or similar. Suggestions appear once they've been checked against the
      source.
    </p>
    <label class="hp" aria-hidden="true">
      Leave this empty
      <input type="text" name="website" tabindex={-1} autocomplete="off" />
    </label>
    <SuggestionFields v={values} prefix="sg" />
    <OutcomeOptions />
    <label for="sg-name">Your name, for credit (optional)</label>
    <input id="sg-name" type="text" name="submitter_name" maxlength={60} autocomplete="nickname" value={values.submitter_name ?? ''} />
    <p class="form-error" id="suggest-error" role="alert">
      {error ?? ''}
    </p>
    <div class="form-actions">
      <button type="submit">Send suggestion</button>
      <a href={`/t/${slug}`} hx-get={`/t/${slug}/suggest/cancel`} hx-target="#suggest-slot" hx-swap="innerHTML">
        Cancel
      </a>
    </div>
  </form>
);

export const SuggestThanks: FC<{ slug: string; company: string }> = ({ slug, company }) => (
  <div class="suggest-thanks" role="status">
    <p>Thanks. {company} will appear here once it's been checked against your source.</p>
    <SuggestLink slug={slug} />
  </div>
);

/** Full-page version for visitors without JavaScript. */
export const SuggestPage: FC<{ slug: string; title: string; values?: SuggestionValues; error?: string; sent?: string }> = ({
  slug,
  title,
  values,
  error,
  sent,
}) => (
  <Layout title={`Suggest a company for ${title}`}>
    <div class="prose">
      <p class="crumbs">
        <a href={`/t/${slug}`}>{title}</a>
      </p>
      <div id="suggest-slot">
        {sent ? <SuggestThanks slug={slug} company={sent} /> : <SuggestForm slug={slug} values={values} error={error} />}
      </div>
    </div>
  </Layout>
);

// ---------- Admin ----------

export const PendingSuggestionCard: FC<{ s: PendingSuggestion; error?: string; values?: SuggestionValues }> = ({
  s,
  error,
  values,
}) => {
  const v: SuggestionValues = values ?? {
    company: s.company,
    start_year: s.start_year ? String(s.start_year) : '',
    end_year: s.end_year ? String(s.end_year) : '',
    outcome: s.outcome,
    notes: s.notes,
    source_url: s.source_url,
  };
  const duplicateHere = s.also_listed.some((t) => t.slug === s.slug);
  const elsewhere = s.also_listed.filter((t) => t.slug !== s.slug).map((t) => t.title);
  return (
    <li class="suggestion" id={`sg${s.id}`}>
      <p class="suggestion-head">
        For <a href={`/t/${s.slug}`}>{s.title}</a>, from {s.submitter_name || 'an anonymous visitor'} on{' '}
        {formatDate(s.created_at)}
      </p>
      {(duplicateHere || elsewhere.length > 0) && (
        <p class="dupe">
          {duplicateHere ? 'Already listed on this entry. ' : ''}
          {elsewhere.length > 0 ? `Also listed under: ${elsewhere.join(', ')}.` : ''}
        </p>
      )}
      <p>
        Source:{' '}
        <a href={s.source_url} target="_blank" rel="noopener noreferrer nofollow">
          {s.source_url}
        </a>
      </p>
      <form class="suggest-form review-form">
        <SuggestionFields v={v} prefix={`r${s.id}`} showState />
        <p class="form-error" id={`sg-error-${s.id}`} role="alert">
          {error ?? ''}
        </p>
        <div class="form-actions">
          <button type="button" hx-post={`/admin/suggestions/${s.id}/approve`} hx-target={`#sg${s.id}`} hx-swap="outerHTML">
            Approve and publish
          </button>
          <button
            type="button"
            class="secondary"
            hx-post={`/admin/suggestions/${s.id}/reject`}
            hx-target={`#sg${s.id}`}
            hx-swap="outerHTML"
          >
            Reject
          </button>
        </div>
      </form>
    </li>
  );
};

export const ReviewedSuggestion: FC<{ id: number; message: string; slug?: string }> = ({ id, message, slug }) => (
  <li class="suggestion reviewed" id={`sg${id}`}>
    <p>
      {message} {slug && <a href={`/t/${slug}`}>View entry</a>}
    </p>
  </li>
);

export const CommunityAttemptRow: FC<{ a: CommunityAttempt }> = ({ a }) => (
  <tr id={`ca${a.id}`}>
    <td>{a.company}</td>
    <td>
      <a href={`/t/${a.slug}`}>{a.title}</a>
    </td>
    <td>{yearSpan(a)}</td>
    <td>{a.outcome}</td>
    <td>{a.suggested_by || 'Anonymous'}</td>
    <td>
      <button
        hx-post={`/admin/attempts/${a.id}/delete`}
        hx-target={`#ca${a.id}`}
        hx-swap="outerHTML"
        hx-confirm={`Remove ${a.company} from ${a.title}?`}
      >
        Remove
      </button>
    </td>
  </tr>
);
