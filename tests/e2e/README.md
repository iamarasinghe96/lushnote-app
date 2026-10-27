# End-to-end suite

Runs against a URL. In CI that URL is the app in local mode on the runner
(`.github/workflows/e2e.yml`): Firebase's emulators with made-up data and the
production build, so no run ever touches the live database. To do the same on
your computer:

```
npm run dev:local -- --reset --prod     # in one terminal
BASE_URL=http://127.0.0.1:3000 E2E_USER_EMAIL=e2e-tester@lushnote.com.au E2E_USER_PASSWORD=local-e2e-password npm run test:e2e
```

The fixture account and its password are made up and exist only in the
emulator (`scripts/seed-local.mjs`). `public.spec.ts` needs nothing;
`authed-flow.spec.ts` skips itself without the two variables.

The AI is mocked on preview deployments (`E2E_MOCK_AI=1`, refused outright in
production). Everything either side of the model call is real.

**Flaky tests are quarantined, never deleted.** CI retries once. A test that
flakes twice in a week gets `test.fixme()` with a dated comment saying why, and
a follow-up to fix it. Blanket-skipping to get a green light defeats the only
purpose this suite has.
