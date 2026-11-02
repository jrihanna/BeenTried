import { raw } from 'hono/html';
import type { Child, FC } from 'hono/jsx';
import { complaintsEmail } from '../reports.js';

export const SITE_NAME = 'BeenTried';

export const Layout: FC<{ title?: string; description?: string; children?: Child }> = ({
  title,
  description,
  children,
}) => (
  <>
    {raw('<!doctype html>')}
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title ? `${title} | ${SITE_NAME}` : `${SITE_NAME}: startup ideas that keep swallowing founders`}</title>
        <meta
          name="description"
          content={
            description ??
            'A field guide to startup ideas that look easy, keep attracting smart founders, and keep failing, with the reasons why.'
          }
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Zilla+Slab:wght@500;700&display=swap"
        />
        <link rel="stylesheet" href="/static/styles.css" />
        <link rel="icon" href="/static/favicon.svg" type="image/svg+xml" />
        <script src="/vendor/htmx.min.js" defer></script>
      </head>
      <body>
        <a class="skip" href="#main">
          Skip to content
        </a>
        <header class="site-header">
          <a class="brand" href="/">
            <svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="2" y="4" width="20" height="4" />
              <rect x="2" y="10" width="20" height="4" />
              <rect x="2" y="16" width="20" height="4" />
            </svg>
            {SITE_NAME}
          </a>
          <nav aria-label="Main">
            <a href="/">The pits</a>
            <a href="/check">Check your idea</a>
            <a href="/about">About</a>
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer class="site-footer">
          <p>
            Every entry lists its sources. Spotted a mistake? Use "Report a problem" next to the company, or suggest a
            missing one.
          </p>
          <p class="footer-links">
            <a href="/about">About</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            {complaintsEmail() && <a href={`mailto:${complaintsEmail()}`}>Complaints: {complaintsEmail()}</a>}
          </p>
        </footer>
      </body>
    </html>
  </>
);
