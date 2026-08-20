# End-to-end suite

Runs against a URL, never against infrastructure it starts itself. In CI that
URL is the Vercel Preview deployment for the pull request — the real app on the
real database, built exactly the way production is.

```
npm run test:e2e                      # starts a local dev server with the preview flags
BASE_URL=https://<preview>.vercel.app npm run test:e2e
```

`public.spec.ts` needs nothing. `authed-flow.spec.ts` needs `E2E_USER_EMAIL`
and `E2E_USER_PASSWORD` for the fixture account (Admin console → Releases →
Provision E2E user) and skips itself without them.

The AI is mocked on preview deployments (`E2E_MOCK_AI=1`, refused outright in
production). Everything either side of the model call is real.

**Flaky tests are quarantined, never deleted.** CI retries once. A test that
flakes twice in a week gets `test.fixme()` with a dated comment saying why, and
a follow-up to fix it. Blanket-skipping to get a green light defeats the only
purpose this suite has.
