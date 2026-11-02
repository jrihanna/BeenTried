import type { Child, FC } from 'hono/jsx';
import type { CheckResult } from '../check.js';
import type { Comment, Tarpit, TarpitSummary, VoteTally } from '../data.js';
import { tagLabel } from '../tags.js';
import { complaintsEmail } from '../reports.js';
import { Layout, SITE_NAME } from './layout.js';
import { CommentForm, CommentItem, paragraphs, PitList, Strata, VoteBox } from './parts.js';
import { SuggestLink } from './suggest.js';

// ---------- Home ----------

export const HomePage: FC<{
  tarpits: TarpitSummary[];
  categories: string[];
  q?: string;
  category?: string;
  totalAttempts: number;
}> = ({ tarpits, categories, q, category, totalAttempts }) => (
  <Layout>
    <section class="hero">
      <h1>Some ideas have already swallowed hundreds of founders.</h1>
      <p class="lede">
        A field guide to startup ideas that look easy, keep attracting smart people, and keep failing. Each pit lists
        who tried, how it ended, and what would have to be different for the next attempt to get out.
      </p>
      <p class="hero-count">
        {tarpits.length && !q && !category
          ? `${totalAttempts} recorded attempts across ${tarpits.length} pits so far.`
          : ''}
      </p>
    </section>

    <form class="finder" method="get" action="/" role="search">
      <label for="q">Search the pits</label>
      <input
        id="q"
        type="search"
        name="q"
        value={q ?? ''}
        placeholder="e.g. group plans, music discovery, grocery delivery"
        hx-get="/"
        hx-trigger="input changed delay:250ms, search"
        hx-target="#pit-list"
        hx-select="#pit-list"
        hx-swap="outerHTML"
        hx-push-url="true"
        hx-include="closest form"
      />
      {category && <input type="hidden" name="category" value={category} />}
      <noscript>
        <button type="submit">Search</button>
      </noscript>
    </form>

    <nav class="categories" aria-label="Filter by category">
      <a href={q ? `/?q=${encodeURIComponent(q)}` : '/'} aria-current={!category ? 'page' : undefined}>
        All
      </a>
      {categories.map((c) => (
        <a
          href={`/?category=${encodeURIComponent(c)}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
          aria-current={category === c ? 'page' : undefined}
        >
          {c}
        </a>
      ))}
    </nav>

    <PitList tarpits={tarpits} q={q} />
  </Layout>
);

// ---------- Tarpit detail ----------

export const TarpitPage: FC<{ tarpit: Tarpit; comments: Comment[]; tally: VoteTally }> = ({
  tarpit: t,
  comments,
  tally,
}) => {
  const earliest = t.attempts.reduce<number | null>(
    (min, a) => (a.start_year && (!min || a.start_year < min) ? a.start_year : min),
    null,
  );
  return (
    <Layout title={t.title} description={t.summary}>
      <article class="tarpit">
        <header class="tarpit-head">
          <p class="crumbs">
            <a href="/">The pits</a> / <a href={`/?category=${encodeURIComponent(t.category)}`}>{t.category}</a>
          </p>
          <h1>{t.title}</h1>
          <p class="lede">{t.summary}</p>
          <p class="depth">
            {t.attempts.length} {t.attempts.length === 1 ? 'company' : 'companies'} recorded
            {earliest ? ` since ${earliest}` : ''}.
          </p>
          {t.status === 'draft' && (
            <p class="draft-note">
              This entry hasn't been fact-checked yet. Treat dates and outcomes as a starting point and check the
              sources.
            </p>
          )}
        </header>

        <div class="tarpit-body">
          <aside class="tarpit-strata" aria-label="Who tried">
            <h2>Who tried</h2>
            <Strata slug={t.slug} attempts={t.attempts} />
            {t.hidden_attempts > 0 && (
              <p class="hint hidden-note">
                {t.hidden_attempts === 1 ? 'One more company is' : `${t.hidden_attempts} more companies are`} hidden
                while a report is checked.
              </p>
            )}
            <div id="report-slot" class="report-slot" aria-live="polite"></div>
            <div id="suggest-slot" class="suggest-slot">
              <SuggestLink slug={t.slug} />
            </div>
          </aside>

          <div class="tarpit-text">
            <section>
              <h2>Why it looks easy</h2>
              {paragraphs(t.why_tempting)}
            </section>

            <section>
              <h2>Why it keeps failing</h2>
              {paragraphs(t.why_it_fails)}
              {t.reasons.length > 0 && (
                <dl class="reasons">
                  {t.reasons.map((r) => (
                    <div>
                      <dt>{tagLabel(r.tag)}</dt>
                      <dd>{r.detail}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>

            <section class="escape">
              <h2>What would have to be true now</h2>
              {paragraphs(t.what_would_change)}
            </section>

            <VoteBox slug={t.slug} tally={tally} />

            {t.sources.length > 0 && (
              <section class="sources">
                <h2>Sources</h2>
                <ul>
                  {t.sources.map((s) => (
                    <li>
                      <a href={s.url} rel="noopener" target="_blank">
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section class="comments" id="comments" aria-labelledby="comments-heading">
              <h2 id="comments-heading">Discussion</h2>
              <p class="hint">
                Tried this yourself, worked at one of these companies, or think something has changed? Add it here.
              </p>
              <CommentForm slug={t.slug} />
              <ol class="comment-list" id="comment-list">
                {comments.map((c) => (
                  <CommentItem slug={t.slug} comment={c} />
                ))}
              </ol>
              {comments.length === 0 && <p class="hint" id="no-comments">No comments yet. Start the discussion.</p>}
            </section>
          </div>
        </div>
      </article>
    </Layout>
  );
};

// ---------- Idea checker ----------

export const CheckPage: FC<{ aiOn: boolean; idea?: string; result?: Child }> = ({ aiOn, idea, result }) => (
  <Layout title="Check your idea" description="See whether your startup idea matches a known tarpit before you build it.">
    <section class="hero hero-small">
      <h1>Check your idea before you dig.</h1>
      <p class="lede">
        Describe what you want to build in a sentence or two. You'll see the closest tarpits, who already tried them,
        and the questions you'd need to answer to do better.
      </p>
    </section>
    <form class="checker" method="post" action="/check" hx-post="/check" hx-target="#check-result" hx-swap="innerHTML" hx-indicator="#check-busy">
      <label for="idea">Your idea</label>
      <textarea
        id="idea"
        name="idea"
        required
        minlength={10}
        maxlength={1500}
        rows={5}
        placeholder="An app that helps groups of friends agree on weekend plans by suggesting events everyone is free for."
      >
        {idea ?? ''}
      </textarea>
      <div class="checker-actions">
        <button type="submit">Check this idea</button>
        <span id="check-busy" class="busy">
          Digging through the pits…
        </span>
      </div>
      <p class="hint">
        {aiOn
          ? 'Matching uses AI embeddings and a short AI-written assessment.'
          : 'Matching uses keywords. Add an OpenAI key to enable semantic matching.'}{' '}
        Ideas you check are saved without your name so we can see which tarpits are missing.
      </p>
    </form>
    <div id="check-result" aria-live="polite">
      {result}
    </div>
  </Layout>
);

export const CheckResultView: FC<{ result: CheckResult }> = ({ result }) => (
  <div class="check-result">
    <p class="check-summary">{result.summary}</p>
    {result.matches.length > 0 && (
      <>
        <h2>Closest pits</h2>
        <ol class="matches">
          {result.matches.map((m) => (
            <li>
              <a href={`/t/${m.slug}`} class="match-title">
                {m.title}
              </a>
              <span class="match-meta">
                {m.attempt_count} {m.attempt_count === 1 ? 'attempt' : 'attempts'} recorded
              </span>
              <p>{m.relation ?? m.summary}</p>
              {m.reasons.length > 0 && (
                <p class="match-reasons">Failed on: {m.reasons.map((r) => tagLabel(r.tag)).join(', ')}</p>
              )}
            </li>
          ))}
        </ol>
      </>
    )}
    <h2>Answer these before you build</h2>
    <ol class="questions">
      {result.questions.map((q) => (
        <li>{q}</li>
      ))}
    </ol>
  </div>
);

// ---------- Static pages ----------

export const AboutPage: FC = () => (
  <Layout title="About">
    <article class="prose">
      <h1>About the pits</h1>
      <p>
        Y Combinator calls them tarpit ideas: startup ideas that sound obviously good, get enthusiastic nods from
        friends, and have quietly trapped founder after founder. The trouble is that the graveyard is usually
        invisible. You find out about the last twenty attempts after you've spent a year on the twenty-first.
      </p>
      <p>
        This site puts the graveyard in plain view. Each entry lists the companies that tried, how they ended, the
        failure modes they had in common, and what would have to be true for a new attempt to work.
      </p>
      <h2>A tarpit isn't a ban</h2>
      <p>
        Ideas leave the pit when something changes: a new technology, a shift in costs, a distribution channel that
        didn't exist before. The point is not to stop you building. It is to make you explain, specifically, why your
        attempt won't end like the others.
      </p>
      <h2>Corrections and complaints</h2>
      <p>
        Entries marked unreviewed haven't been fact-checked yet. If a company's dates or outcome are wrong, or a
        listing is unfair to someone, use "Report a problem" next to that company. It's hidden from the page while
        we check it against the source. Comments have a "Report" link that works the same way.
      </p>
      {complaintsEmail() && (
        <p>
          For a formal complaint, or anything the report links don't cover, email{' '}
          <a href={`mailto:${complaintsEmail()}`}>{complaintsEmail()}</a>.
        </p>
      )}
    </article>
  </Layout>
);

/**
 * Plain-language privacy policy describing what this codebase actually collects. Review it (ideally
 * with a lawyer) before launch, and update it whenever the data collected changes.
 */
export const PrivacyPage: FC<{ aiOn: boolean }> = ({ aiOn }) => {
  const email = complaintsEmail();
  return (
    <Layout title="Privacy">
      <article class="prose">
        <h1>Privacy</h1>
        <p class="hint">Last updated {PRIVACY_UPDATED}.</p>
        <p>
          {SITE_NAME} is run from Australia. There are no accounts. This page lists everything the site collects, why,
          and who else sees it.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>A visitor cookie.</strong> A random id in a cookie called <code>vid</code>, kept for a year, so each
            visitor gets one vote per entry. We store a scrambled (hashed) version of it with your vote, not the id
            itself.
          </li>
          <li>
            <strong>A scrambled version of your IP address.</strong> When you comment, suggest a company or send a
            report, we store a one-way hash of your IP address with it. We use it to limit spam and to spot abuse. It
            can't be turned back into your address.
          </li>
          <li>
            <strong>Comments.</strong> The name you type and your comment. Both are public.
          </li>
          <li>
            <strong>Company suggestions.</strong> The details and source you send, and your name if you give one for
            credit. The company and your name become public if the suggestion is approved.
          </li>
          <li>
            <strong>Reports.</strong> What you report, why, and your email if you choose to give it. None of this is
            public. Your email is only used to reply about that report.
          </li>
          <li>
            <strong>Ideas you run through the checker.</strong> The text of the idea, so we can see which tarpits are
            missing from the site. It isn't linked to you.
          </li>
        </ul>

        <h2>Who else sees it</h2>
        <ul>
          <li>Our hosting and database providers store the site's data and may keep standard server logs.</li>
          {aiOn && (
            <li>
              Ideas you run through the checker, and the company and report text when something is reported, are sent
              to OpenAI to match and assess them. OpenAI processes data in the United States.
            </li>
          )}
          <li>The site's fonts load from Google Fonts, which receives your IP address when you visit.</li>
          <li>
            When something is reported, the admin gets a short notification that names the company or comment author
            and the reason. It doesn't include what you wrote or your email.
          </li>
          <li>We don't sell data, run ads or use analytics trackers.</li>
        </ul>

        <h2>Children</h2>
        <p>
          The site is meant for adults interested in startups. There are no accounts, and reading doesn't need one.
        </p>

        <h2>Your choices</h2>
        <p>
          You can read everything without commenting, suggesting or reporting. You can clear the <code>vid</code>{' '}
          cookie at any time; you'll just be able to vote again.{' '}
          {email ? (
            <>
              To ask what we hold about you, or to have a comment, suggestion or report removed, email{' '}
              <a href={`mailto:${email}`}>{email}</a>.
            </>
          ) : (
            <>To have a comment removed, use its "Report" link.</>
          )}
        </p>
      </article>
    </Layout>
  );
};

/** Change this whenever the privacy policy text changes. */
const PRIVACY_UPDATED = '29 October 2026';

/**
 * Terms of use. Covers the Online Safety Act basics (no illegal or harmful content, a way to complain,
 * prompt removal) and sets out the takedown process the defamation defences for digital intermediaries
 * rely on. Review it (ideally with a lawyer) before launch.
 */
export const TermsPage: FC<{ aiOn: boolean }> = ({ aiOn }) => {
  const email = complaintsEmail();
  return (
    <Layout title="Terms of use" description={`The rules for reading and posting on ${SITE_NAME}.`}>
      <article class="prose">
        <h1>Terms of use</h1>
        <p class="hint">Last updated {TERMS_UPDATED}.</p>
        <p>
          {SITE_NAME} is a free site run from Australia. By using it you agree to these terms. If you don't agree,
          please don't post anything here. You can still read the site.
        </p>

        <h2>What the site is</h2>
        <p>
          {SITE_NAME} is a catalogue of startup ideas that many founders have tried. Each entry summarises public
          information about companies that worked on the idea, with links to the sources. It's general information
          and opinion. It isn't business, financial, investment or legal advice. Do your own research before you
          make a decision.
        </p>
        <p>
          We try hard to get the facts right, and every company listing should link to a source. Entries marked
          unreviewed haven't been fact-checked yet. A listing means a company worked on an idea. It doesn't mean
          the company, or anyone involved with it, did anything wrong. If something is out of date or wrong, please
          tell us (see <a href="#complaints">Complaints and takedowns</a>).
        </p>

        <h2>Who can post</h2>
        <p>
          You need to be 18 or older to comment, suggest a company or vote. You don't need an account. You're
          responsible for what you post.
        </p>

        <h2>What you can't post</h2>
        <p>Don't post, or link to, anything that:</p>
        <ul>
          <li>is illegal in Australia, or encourages or helps anyone to commit a crime;</li>
          <li>
            states something about a real person or company as fact when it's false or you can't back it up. Opinions
            are fine if they're clearly opinions, and you should say what they're based on;
          </li>
          <li>harasses, threatens, intimidates or bullies anyone;</li>
          <li>
            attacks people for their race, religion, sex, sexuality, gender identity, disability or similar
            characteristics;
          </li>
          <li>
            shares someone's private information, such as their home address, phone number, personal email or
            private messages, without their permission;
          </li>
          <li>is sexually explicit or violent, or isn't suitable for a general adult audience;</li>
          <li>copies someone else's work in a way that infringes their copyright, or reveals confidential information;</li>
          <li>pretends to be someone else, or misleads people about who you are or who you work for;</li>
          <li>is spam, advertising or self-promotion, or links to malware or scams.</li>
        </ul>
        <p>
          Don't try to get around rate limits, vote more than once per entry, use bots to post, or disrupt the site
          in any other way.
        </p>

        <h2>Your posts</h2>
        <p>
          You keep ownership of what you write. By posting, you give us a free, worldwide, non-exclusive licence to
          publish, display, store and moderate it on the site and in exports of the site's content, for as long as
          it stays up. Comments are public as soon as you post them. A suggested company is only published after we
          check it against its source, and we may rewrite it to fit our format.
        </p>

        <h2>Moderation</h2>
        <p>
          We can hide or remove any comment, suggestion or listing at any time, and block anyone from posting, if we
          believe it breaks these terms or the law. We don't check comments before they appear, and we don't endorse
          what visitors post. Content that's reported may be hidden automatically while we look at it.
        </p>

        <h2>The idea checker</h2>
        <p>
          The checker compares your idea with the entries on the site
          {aiOn ? ', using an automated AI service' : ''}. Its results are automatically generated and can be wrong
          or incomplete. Use them as a starting point, not a verdict. We keep the text you submit
          {aiOn ? ' and send it to our AI provider' : ''}, so don't enter anything confidential. See the{' '}
          <a href="/privacy">privacy policy</a>.
        </p>

        <h2 id="complaints">Complaints and takedowns</h2>
        <p>
          If you think something on the site is false, defamatory, illegal, harmful or infringes your rights, use the
          "Report a problem" link next to the company or the "Report" link on the comment.
          {email && (
            <>
              {' '}
              You can also email <a href={`mailto:${email}`}>{email}</a>. Tell us the page, what's wrong, and why.
            </>
          )}
        </p>
        <p>
          A report usually hides the item while we review it. We aim to review every report within 2 business days,
          and we act on valid complaints within 7 days at the latest. We'll correct or remove the content, or keep it
          up and explain why if you've given us a way to reply. If you're not satisfied with how a complaint about
          harmful online content was handled, you can also complain to the{' '}
          <a href="https://www.esafety.gov.au/report">eSafety Commissioner</a>.
        </p>

        <h2>Links to other sites</h2>
        <p>
          Entries and comments link to other websites. We don't control those sites and aren't responsible for what's
          on them.
        </p>

        <h2>Liability</h2>
        <p>
          The site is provided free and as is. We don't promise it will always be available, error-free or up to
          date. As far as the law allows, we aren't liable for any loss that comes from using the site or relying on
          its content, including decisions about starting or funding a business.
        </p>
        <p>
          Nothing in these terms excludes, restricts or changes any right or remedy you have under the Australian
          Consumer Law or any other law that can't be excluded.
        </p>

        <h2>Changes</h2>
        <p>
          We may update these terms. The date at the top shows when they last changed. If you keep using the site
          after a change, the new terms apply to you from then on.
        </p>

        <h2>Governing law</h2>
        <p>
          These terms are governed by the law of New South Wales, Australia, and the courts of New South Wales have
          jurisdiction over any dispute about them.
        </p>
      </article>
    </Layout>
  );
};

/** Change this whenever the terms text changes. */
const TERMS_UPDATED = '2 November 2026';

export const NotFoundPage: FC = () => (
  <Layout title="Not found">
    <section class="hero hero-small">
      <h1>Nothing down here.</h1>
      <p class="lede">
        That page doesn't exist. <a href="/">Go back to the pits</a>.
      </p>
    </section>
  </Layout>
);
