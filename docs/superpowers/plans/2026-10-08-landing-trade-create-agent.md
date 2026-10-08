# Landing Trade v2 and public Create Agent — implementation plan

Spec: `docs/specs/landing-trade-v1.md`. Branch `codex/landing-trade-create-agent`.

Every colour is a `--pk-*` token read by name in a CSS module; no literal, no alias, no `--pk-*`
definition outside `packages/ui/src/styles.css`. `npm run design:source` is the check. Shared controls
come from `@pickler/ui` (`Button`, `ButtonLink`, `Input`, `Textarea`, `Icon`, `Chip`).

## Tasks

1. **Token** — add `--pk-glow-violet` to `packages/ui/src/styles.css`, light and dark blocks, with the
   comment explaining it is the violet glow under the phones and the mascot.
2. **Nav** — `features/site/site-nav.tsx`: Build › "Create Agent" → `/apply`; props
   `secondary?: { label, href }` and `action?: { label, href }` with defaults "Get the app" → `/#app`
   and "Create agent" → `/apply`; the CSS gains the quiet pill (`.secondary`).
3. **Apply page** — `features/apply/`: delete `apply-shell.tsx`, `no-seat.tsx`; rewrite
   `application-form.tsx` (email field, waitlist-then-application submit), `submitted.tsx`,
   `apply-flow.tsx`, add `apply-page.tsx` (hero, why, arena, application, footer), `lib/form-model.ts`
   (pure) and `apply.module.css`; `app/apply/page.tsx` renders `ApplyPage` with the server-read
   applicant or null. Test `apps/web/test/apply-form.test.ts`.
4. **Phones** — `features/landing/components/phone/{frame,sign-in,wallet,agents,market}.tsx` and
   `phone.module.css`, static, `aria-hidden`, 441px wide, from `scratchpad/mobile-screens.md`.
5. **Landing** — `features/landing/`: delete `tape.tsx`, `four-moves.tsx`, `runs-on.tsx`, `hero.tsx`,
   `agents-created.tsx`, `backed.tsx`, `waitlist-form.tsx`, `landing-nav.tsx`, `lib/format.ts`
   (keep `news-pill.tsx`, `mark.tsx`, `footer.tsx` reworked, `lib/landing-data.tsx`, `lib/palette.ts`);
   add `headline.tsx`, `hero-phone.tsx`, `ways.tsx`, `steps.tsx`, `bento.tsx` (record, ask, keys,
   curve), `faq.tsx`, `download.tsx`; `lib/demo.ts` (pure: bubble pairs, candle stack, curve fill,
   steps, faq copy) with `apps/web/test/landing-demo.test.ts`; rewrite `landing.module.css`;
   `landing-page.tsx` composes them.
6. **Harness and docs** — `scripts/design/routes.mjs` (`landing` proves `#how`; `apply` proves
   `#apply-form`, light), `scripts/design/surfaces.mjs` `MUST_NEST`, `apps/web/AGENTS.md` (landing,
   apply, nav sections), `.env.example` (`NEXT_PUBLIC_APP_STORE_URL`).
7. **Checks** — `npm run design:source`, `npm run lint`, `npm run typecheck`, `node --import tsx
--test apps/web/test/apply-form.test.ts apps/web/test/landing-demo.test.ts`, `npm run build
--workspace=@pickler/web`, then `npm run dev` and look at `/` and `/apply` at 1440 and 390.
