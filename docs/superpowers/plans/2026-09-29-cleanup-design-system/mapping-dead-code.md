# Mapping: dead code (batch F)

Taken from the inventory (`docs/specs/cleanup-inventory-2026-09-29.md`, section 3) and checked against the code: the class lists are what `npm run design:source` reports as `unused-class`, and the rules are what `tools/derule.mjs` printed in the verified run.

## Classes kept, and why

Reached only through a computed `styles[...]`, which no search of the source can see. They are the `KEEP` list in `scripts/design/source.mjs`.

| Module                       | Classes                                                          | Computed at                                                                                              |
| ---------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `agents/agents.module.css`   | `resultWon`, `resultLost`, `resultOpen`                          | `styles[outcomeClass[...]]` in `token-page.tsx` and `pick-detail.tsx`; the map is `agents/lib/format.ts` |
| `agents/agents.module.css`   | `kindCALL`, `kindPOSITION`, `kindPASS`, `kindANSWER`, `kindPERP` | ``styles[`kind${kindLabel[event.kind]}`]`` in `activity-row.tsx`                                         |
| `markets/markets.module.css` | `long`, `short`                                                  | `styles[quote.side]` in `trade-ticket.tsx`                                                               |

## `apps/web/src/features/agents/agents.module.css` — task 27

32 classes, in `maps/27-agents-classes.txt`: `.navTab`, `.navTabActive`, `.spacer`, `.search`, `.stageButton`, `.resultCount`, `.grid`, `.card`, `.cardTop`, `.cardFoot`, `.cardHead`, `.cardName`, `.cardStats`, `.cardStat`, `.curve`, `.cardCta`, `.followChip`, `.backCurve`, `.bar`, `.barFill`, `.chartStats`, `.heroPrice`, `.navCta`, `.navItem`, `.filterRowSplit`, `.viewToggle`, `.viewButton`, `.curveLabel`, `.tableMark`, `.tableStage`, `.tableCta`, `.ghostButton`.

53 rules, selectors or keyframes removed:

| Removed                                            |
| -------------------------------------------------- |
| `.page a.navTab`                                   |
| `.page a.navTabActive, .page a.navTabActive:hover` |
| `.spacer`                                          |
| `.search`                                          |
| `.stageButton`                                     |
| `.stageButton:hover`                               |
| `.stageButton[aria-pressed="true"]`                |
| `.stageButton span`                                |
| `.resultCount`                                     |
| `.grid`                                            |
| `.card`                                            |
| `.card:hover`                                      |
| `.cardTop`                                         |
| `.page a.cardTop:hover`                            |
| `.cardFoot`                                        |
| `.cardHead`                                        |
| `.cardName`                                        |
| `.cardName strong`                                 |
| `.cardName > span`                                 |
| `.cardStats`                                       |
| `.cardStat`                                        |
| `.cardStat:first-child`                            |
| `.cardStat:last-child`                             |
| `.cardStat dd`                                     |
| `.cardStat dt`                                     |
| `.cardFoot`                                        |
| `.curve`                                           |
| `.cardCta`                                         |
| `.page a.followChip`                               |
| `.backCurve .bar`                                  |
| `.backCurve .barFill`                              |
| `.backCurve .curveNote`                            |
| `.grid`                                            |
| `.chartStats`                                      |
| `@media (min-width: 760px) (left empty)`           |
| `.grid`                                            |
| `@media (min-width: 1060px) (left empty)`          |
| `.heroPrice`                                       |
| `.navCta`                                          |
| `@media (max-width: 640px) (left empty)`           |
| `.page a.navItem:hover`                            |
| `.filterRowSplit`                                  |
| `.viewToggle`                                      |
| `.viewButton`                                      |
| `.curveLabel`                                      |
| `.curve strong`                                    |
| `.tableMark`                                       |
| `.tableStage`                                      |
| `.tableCta`                                        |
| `.ghostButton`                                     |
| `.page a.ghostButton:hover, .ghostButton:hover`    |
| `.page a.cardCta:hover`                            |
| `.page a.cardCta, .page a.cardCta:hover .cardCta`  |

## `apps/web/src/features/auth/auth.module.css` — task 28

59 classes, in `maps/28-auth-classes.txt`: `.switchNote`, `.switchButton`, `.ghostButton`, `.good`, `.warn`, `.bad`, `.open`, `.eyebrow`, `.headline`, `.steps`, `.step`, `.stepActive`, `.methods`, `.method`, `.methodText`, `.check`, `.card`, `.strength`, `.strengthBar`, `.strengthFill`, `.strengthLabel`, `.terms`, `.box`, `.termsText`, `.continue`, `.cardNote`, `.actions`, `.back`, `.signin`, `.signinGlow`, `.signinStars`, `.fallingPiece`, `.fall`, `.fallSpin`, `.signinColumn`, `.mascotTop`, `.glassCard`, `.cardTitle`, `.cardLead`, `.walletButton`, `.stack`, `.boardNow`, `.boardNowHead`, `.callRow`, `.callTicker`, `.callText`, `.callResult`, `.footerLinks`, `.done`, `.doneBox`, `.doneBadge`, `.icon`, `.doneTitle`, `.doneBody`, `.doneFoot`, `.notBuilt`, `.created`, `.addressButton`, `.copyFailed`.

83 rules, selectors or keyframes removed:

| Removed                                          |
| ------------------------------------------------ |
| `.switchNote`                                    |
| `.page a.switchButton, .ghostButton`             |
| `.page a.switchButton:hover, .ghostButton:hover` |
| `.good`                                          |
| `.warn`                                          |
| `.bad`                                           |
| `.open`                                          |
| `.eyebrow`                                       |
| `.headline`                                      |
| `.steps`                                         |
| `.step`                                          |
| `.step span`                                     |
| `.stepActive`                                    |
| `.methods`                                       |
| `.page .method`                                  |
| `.method:hover`                                  |
| `.method[aria-checked="true"]`                   |
| `.methodText`                                    |
| `.methodText strong`                             |
| `.methodText span`                               |
| `.check`                                         |
| `.card`                                          |
| `.strength`                                      |
| `.strengthBar`                                   |
| `.strengthFill`                                  |
| `.strengthLabel`                                 |
| `.terms`                                         |
| `.terms input`                                   |
| `.box`                                           |
| `.terms input:checked + .box`                    |
| `.terms input:focus-visible + .box`              |
| `.termsText`                                     |
| `.continue`                                      |
| `.cardNote`                                      |
| `.actions`                                       |
| `.actions .primary`                              |
| `.back`                                          |
| `.signin`                                        |
| `.signinGlow`                                    |
| `.signinStars`                                   |
| `.fallingPiece`                                  |
| `.fallingPiece .cell`                            |
| `.fall`                                          |
| `.fallSpin`                                      |
| `.signinColumn`                                  |
| `.mascotTop`                                     |
| `.glassCard`                                     |
| `.cardTitle`                                     |
| `.cardLead`                                      |
| `.page .walletButton`                            |
| `.walletButton:hover:not(:disabled)`             |
| `.walletButton:disabled`                         |
| `.stack`                                         |
| `.stack .primary`                                |
| `.boardNow`                                      |
| `.boardNowHead`                                  |
| `.boardNowHead span:last-child`                  |
| `.callRow`                                       |
| `.callTicker`                                    |
| `.callText`                                      |
| `.callResult`                                    |
| `.footerLinks`                                   |
| `.page .footerLinks a`                           |
| `.page .footerLinks a:hover`                     |
| `.footerLinks span`                              |
| `.done`                                          |
| `.doneBox`                                       |
| `.doneBadge`                                     |
| `.doneBadge .icon`                               |
| `.doneTitle`                                     |
| `.doneBody`                                      |
| `.doneFoot`                                      |
| `.doneBox .primary`                              |
| `@keyframes fallSpin`                            |
| `@keyframes fall`                                |
| `@keyframes stars`                               |
| `@keyframes pop`                                 |
| `.notBuilt`                                      |
| `.created`                                       |
| `.page .addressButton`                           |
| `.addressButton:hover`                           |
| `.copyFailed`                                    |
| `.copyFailed span`                               |

## `landing`, `home`, `studio` — task 29

6 rules, selectors or keyframes removed:

| Removed                              |
| ------------------------------------ |
| `.display`                           |
| `.briefName`                         |
| `.briefPrompt`                       |
| `.accentRow`                         |
| `.accentSwatch`                      |
| `.accentSwatch[aria-checked="true"]` |

## `apps/web/src/features/agents/agents.module.css`, after the dead components go — task 30

3 rules, selectors or keyframes removed:

| Removed     |
| ----------- |
| `.marks`    |
| `.mark`     |
| `.mark img` |

## Declarations deleted — task 30

| Declaration                                  | File                                | Why it goes                                                         | Goes with it                                                                                       |
| -------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `VenueMarks`                                 | `agents/components/agent-parts.tsx` | no reference anywhere                                               | the classes `.marks` and `.mark`, which only it named                                              |
| `VenueChip`, `venueLabel`                    | `agents/components/agent-parts.tsx` | no reference anywhere                                               | the `VenueDto` import                                                                              |
| `agentsWithToken`                            | `agents/lib/empty.ts`               | the token board it filtered for was replaced by `LaunchBoard`       | two tests and the `curve` fixture in `marketplace-empty.test.ts`; the `hasToken` import            |
| `SHAPE_ACCENT`                               | `auth/lib/shapes.ts`                | no reference anywhere; `ACCENT_SHAPE` is the live direction         | —                                                                                                  |
| `Plugin`                                     | `studio/api.ts`                     | no reference anywhere                                               | —                                                                                                  |
| `updateConfig`                               | `studio/api.ts`                     | no reference anywhere; `studio.tsx` calls the route itself          | —                                                                                                  |
| `fromViemAccount`, `ViemAccountLike`         | `wallet/lib/signer-adapters.ts`     | Mera's path; the SDK is in no `package.json`                        | one test in `signer-adapters.test.ts`                                                              |
| `PasskeyUnusableError`, `isPrfUnavailable`   | `wallet/lib/signer-adapters.ts`     | only a `MeraError` could produce it, and nothing can throw one (A9) | two tests; `describeSignerFailure` keeps its one live job, turning what was thrown into an `Error` |
| `ACCENT_COLORS`, `ACCENT_ORDER`, `colorVars` | `lib/accent.ts`                     | removed by task 26                                                  | —                                                                                                  |

## Exports kept although only tests import them

Spec 3.3 keeps an export whose test pins behaviour the product has. These are constants and pure functions of live modules; the three below are the ones the inventory listed as unused in their own file.

| Export             | File                     | Why it stays                                                                                                                                                                                   |
| ------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stepsFor`         | `auth/lib/flow.ts`       | `flow.test.ts` asserts the rails through it; the rails are what the form asks of a person                                                                                                      |
| `forgetRail`       | `studio/lib/rail.ts`     | the test seam `studio.test.ts` needs to clear a cached snapshot                                                                                                                                |
| `policyReasonText` | `studio/brief/result.ts` | `studio-brief-run.test.ts` reaches it with a dynamic `import()`, which the inventory's program could not see; the first draft of the list below removed its `export` and the type check failed |

## `export` removed — task 30, `maps/30-unexport.tsv`

Used in their own file and named nowhere else. The declaration stays; the keyword goes.

| File                                                 | Declarations                                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `features/account/lib/coverage.ts`                   | `Coverage`, `CoverageCopy`                                                                                               |
| `features/account/lib/preview.ts`                    | `PreviewState`                                                                                                           |
| `features/agents/components/read-parts.tsx`          | `deliveryLabel`, `evaluationLabel`                                                                                       |
| `features/auth/components/steps/new-device-step.tsx` | `UsePhonePhase`                                                                                                          |
| `features/auth/lib/account.ts`                       | `AccountResult`, `OAuthProvider`                                                                                         |
| `features/auth/lib/custody.ts`                       | `CustodyApi`, `Landing`, `EnrolmentStore`                                                                                |
| `features/auth/lib/flow.ts`                          | `Mode`                                                                                                                   |
| `features/auth/lib/handle.ts`                        | `HandleCheck`, `HandleNote`                                                                                              |
| `features/auth/lib/sheet.ts`                         | `SheetInput`, `SheetCopy`                                                                                                |
| `features/auth/lib/signup-entry.ts`                  | `SIGNUP_PREVIEWS`                                                                                                        |
| `features/markets/lib/ticket.ts`                     | `liquidationPrice`, `Quote`                                                                                              |
| `features/studio/api.ts`                             | `AgentRecord`, `CreateAgentInput`, `DepositPrepared`, `UnsignedActivityDto`, `PrepareWalletResult`, `HandleAvailability` |
| `features/studio/brief/model.ts`                     | `StepperKey`, `TERMINAL`, `CreateProblem`, `CreatePress`                                                                 |
| `features/studio/brief/result.ts`                    | `RunResult`                                                                                                              |
| `features/studio/create/ceremony.ts`                 | `AgentWallet`, `ExistingWallet`, `CeremonyResult`                                                                        |
| `features/studio/create/describe.tsx`                | `LINE_MAX`                                                                                                               |
| `features/studio/create/draft.ts`                    | `CustomSkill`, `SoonRow`, `CreateAgentBody`                                                                              |
| `features/studio/create/first-run.tsx`               | `StepState`                                                                                                              |
| `features/studio/create/flow.ts`                     | `Mode`, `FlowAction`, `StepParam`                                                                                        |
| `features/studio/create/name.tsx`                    | `handleHint`                                                                                                             |
| `features/studio/create/reading.tsx`                 | `REVEAL_MS`                                                                                                              |
| `features/studio/create/review.tsx`                  | `blockedBy`                                                                                                              |
| `features/studio/create/trace.ts`                    | `TraceTint`, `TraceLine`                                                                                                 |
| `features/studio/decision.ts`                        | `ReasonCode`, `ReportSection`                                                                                            |
| `features/studio/home/access.ts`                     | `MenuAccess`                                                                                                             |
| `features/studio/home/fixture.ts`                    | `HomeFixture`                                                                                                            |
| `features/studio/home/home.tsx`                      | `HomePreview`                                                                                                            |
| `features/studio/home/stage.ts`                      | `BRIEF_STAGES`                                                                                                           |
| `features/studio/home/status.ts`                     | `Mood`, `Tint`, `StatusInput`, `elapsed`, `ScheduleView`                                                                 |
| `features/studio/lib/landing.ts`                     | `Landing`                                                                                                                |
| `features/studio/lib/passkey.ts`                     | `session`                                                                                                                |
| `features/studio/preview.ts`                         | `PreviewState`                                                                                                           |
| `features/wallet/lib/wallet-context.tsx`             | `WalletStatus`, `SessionStatus`                                                                                          |
| `features/wallet/lib/wallet-session.ts`              | `SessionNamespace`, `ConnectedWallet`, `AdoptedSession`, `SessionDecision`, `ClientSession`, `SessionClient`             |
| `features/wallet/lib/wallet-sign-in.ts`              | `SignInAttempt`                                                                                                          |
