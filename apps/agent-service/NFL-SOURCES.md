# NFL source assessment

Reviewed against primary documentation on 2026-09-17. This is a coverage assessment, not a live evaluation of unconfigured providers. No subscriptions or new credentials were provisioned.

## Immediate choice

Keep the working Polymarket and Exa plugins for live pilot acceptance. Use retrieved league/team reports for current injuries, track their publication dates, and distinguish reporting from predictions. Missing facts remain explicit. The [NFL injury page](https://www.nfl.com/injuries/) is an official starting point; team-specific reports can be discovered by the existing search capability. Reading still requires an exact authorized search/rules URL. This does not install a new integration or bypass plugin permissions.

## Provider roles

| Option                                                                          | Suitable role                                                       | Limitation / decision                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [BALLDONTLIE](https://nfl.balldontlie.io/)                                      | Basic schedule, teams and recent results with the existing adapter  | Free access excludes injuries, statistics and rosters. Paid tiers add coverage, but those endpoints are not implemented here. Keep optional; do not treat the current plugin as a complete NFL research feed.                                   |
| [The Odds API](https://the-odds-api.com/liveapi/guides/v4/)                     | Contemporary bookmaker-price reference                              | It supplies odds, not an independent forecast or injury explanation. Compare settlement rules and account for margins. Keep optional.                                                                                                           |
| [Sportradar NFL](https://developer.sportradar.com/football/docs/nfl-ig-rosters) | Candidate for a dedicated injury/roster plugin                      | Documents weekly injury status, practice participation, rosters and depth charts. Verify access, licensing, price, timeliness and event matching with a trial before selecting it. Not yet integrated or live-tested.                           |
| [SportsDataIO](https://sportsdata.io/developers/workflow-guide/nfl)             | Alternative specialized NFL feed                                    | Covers the event lifecycle and injury/statistical updates. Its [free trial scrambles some values](https://sportsdata.io/help/scrambled-data); never use those values as real evidence. Accurate production access requires separate evaluation. |
| [nflverse](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html)  | Candidate for historical performance/context and future calibration | Its availability page warns that the old injury source stopped after 2024 and provides no restoration ETA. Do not assume current injury coverage. Validate freshness and licensing per dataset.                                                 |

## Recommendation and acceptance gate

A specialist injury/roster plugin offers more incremental research value than adding another generic web-search provider. Evaluate Sportradar and SportsDataIO against the same upcoming games, alongside official team reports, before choosing. They are candidates, not a claim of better forecast performance.

A future implementation must be independently switchable per agent, declare exact capabilities, preserve source/update timestamps, validate team/player/event identity, respect quotas and cache permissions, and distinguish absent coverage from failure. Disabling it must leave the baseline research usable with honest limitations. No automatic provider fallback or fabricated trial evidence is acceptable.

Track implementation and provider qualification in [issue #14](https://github.com/Relayerfi/pickler/issues/14). Calibration and profitability require separate outcome-based evaluation in [issue #12](https://github.com/Relayerfi/pickler/issues/12).
