# Verification report (sandbox, 2026-10-20)

Environment: n8n 2.43.8 on Node 24.22, SQLite, task runners on. The workflows were imported with `n8n import:workflow`, activated with `n8n publish:workflow`, and run via the production webhook (`POST /webhook/placidway-run`). Results were read from n8n's execution data (`tools/trigger_run.py`, `tools/inspect_executions.py`).

The doubles came from `tools/sandbox_services.py`:
- **Replay mirror.** Real robots.txt, real sitemap entries, and text from 6 real PlacidWay pages captured in a real browser.
- **Mock LLM.** Deterministic and extractive. It is used here to test the *pipeline*, and is **not** the source of the sample posts.
- **Webhook sink.**
- **Mock Graph API.** Returns the real response and error shapes.

## End-to-end scenarios (all executed in a running n8n instance)

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Dry run, article (auto mode) | ✅ success. Article 9795 chosen, image from `og:image`, 364 chars before link, guardrails pass on attempt 1, simulated `/photos` request recorded, `pw_runs` + `pw_posted` rows written | `group1/runs/1.json` |
| 2 | Dry run, Q&A answer | ✅ success (answer 571066, category stem-cell) | `group1/runs/2.json` |
| 3 | Dry run, package | ✅ success (package 8457, image from page) | `group1/runs/3.json` |
| 4 | De-duplication | ✅ second package run picked 7041, not 8457 again | `group1/runs/4.json` |
| 5 | Nothing new left | ✅ `NO_NEW_CONTENT` → logged as `skipped` + alert sent | `group1/runs/5.json`, `group1/outbox.jsonl` |
| 6 | Guardrail rewrite loop | ✅ the injected draft ("Guaranteed results… $999… cures") was caught by rules (4 issues) **and** the LLM reviewer (2), rewritten, and passed on attempt 2 → dry run | `group1/runs/7.json` (and final run 4) |
| 7 | Guardrail block | ✅ when attempt 2 also failed → `GUARDRAIL_BLOCKED`, draft kept in log, alert sent, nothing published | `group1/runs/6.json` |
| 8 | Approval → approve | ✅ execution `waiting`, reviewer message with draft + signed approve/reject links delivered to the webhook, approve click resumed the run → dry-run publish + log | `group1/runs/8.json`, `group1/outbox.jsonl` |
| 9 | Approval → reject | ✅ resumed into `Set Rejected / Expired` → logged `rejected` | `group2/runs/1.json` |
| 10 | Site down (503) | ✅ 3 attempts 5 s apart (replay hits at t, +5 s, +10 s) → `SOURCE_DOWN` → log + alert | `group2/runs/2.json`, `group2/replay_hits.jsonl` |
| 11 | Cloudflare challenge (simulated) | ✅ `SOURCE_BLOCKED` | `group2/runs/3.json` |
| 12 | LIVE branch, photo post (mock Graph) | ✅ `POST /v24.0/957899504078846/photos` with image URL + caption → `published`, post id stored | `group3/runs/1.json`, `group3/graph_requests.jsonl` |
| 13 | LIVE branch, link post | ✅ `POST /feed` with message + link → `published` | `group3/runs/2.json` |
| 14 | LIVE branch, scheduled | ✅ `/feed` with `published=false`, `scheduled_publish_time` (+60 min), `unpublished_content_type=SCHEDULED` → `scheduled` | `group4_live_mock_graph/runs/1.json` |
| 15 | Facebook token expired (OAuth 190) | ✅ 3 attempts → `FB_TOKEN_EXPIRED` → log + alert with fix steps; URL **not** marked as posted | `group3/runs/4.json`, `group3/outbox.jsonl` |
| 16 | **Real placidway.com** (dry run) | ✅ real robots.txt fetched and applied; the sitemap request got Cloudflare's "Just a moment" challenge (HTTP 403) because the sandbox egress is an AWS IP. Detected → `SOURCE_BLOCKED` → alert. No bypass attempted | `group5_real_site/runs/1.json`, `group5_real_site/outbox.jsonl` |
| 17 | Dashboard | ✅ `GET /webhook/placidway-dashboard` → 200 text/html with status counts, posts, images, errors, approve/reject links for the pending run | `archive_pre_restart/dashboard.html` |
| 18 | Export round-trip | ✅ `n8n export:workflow` of all 3 workflows → `workflows/exported/` | |

## Politeness
- Within a run, the minimum gap between requests to the source was **1.12 s** (max 5.0 s during retries), across 45 measured gaps.
- Back-to-back manual runs could start 0.7 s after the previous run's last request. A `Throttle 1 req/s (start)` wait was added before the robots.txt request to cover that case.
- User-Agent `PlacidWayFBDemoBot/1.0 (+assessment demo; contact …)` on every request.

## Unit tests
`node tests/run_unit_tests.mjs`: **23 checks pass** (22 originally + 1 regression check for the classifier fix below). They cover:
- robots parsing on the real robots.txt, disallow handling and Crawl-delay
- selection on the real 5,129-URL article sitemap (dedupe, variety, skip pattern)
- parsing of all 6 captured pages, including the check that related-listing prices don't leak
- Cloudflare detection
- guardrail pass/fail cases (claims, prices, numbers, quotes, length) and `ALLOW_PRICES`
- error classification

## Not verified (needs things the sandbox doesn't have)
- **Real Facebook publish**: needs a Page token with `pages_manage_posts` (README §5).
- **Real LLM output quality and the 3 sample posts**: needs an LLM API key (`scripts/generate_samples.sh`).
- **Live fetch of sitemap and pages** from a network that isn't challenged by Cloudflare.

## Note
The sandbox restarted once during the session. The workflow changes made after these runs (an extra start throttle, the `SKIP_URL_PATTERN` filter, error-message clean-up) were re-verified with a final run set. See "Final regression run" below.

## Final regression run (2026-10-20, after the sandbox restart)

Environment: n8n 2.43.8 on Node 24.22 (npm install in the sandbox), SQLite, task runners on. Workflows rebuilt with `scripts/build_workflows.py`, imported with `n8n import:workflow`, activated with `n8n publish:workflow`, and triggered through `POST /webhook/placidway-run` (`tools/trigger_run.py`). Every run used the local doubles only: replay mirror (`PW_BASE_URL=http://127.0.0.1:8787`), deterministic mock LLM, webhook sink and mock Graph API (`FB_GRAPH_BASE_URL=http://127.0.0.1:8790`). Nothing reached Facebook, placidway.com or any LLM provider. Each group started on a fresh n8n database, so de-duplication starts clean.

### Bug found and fixed during this run
The first guardrail-block attempt came back as **`SOURCE_BLOCKED`** instead of `GUARDRAIL_BLOCKED`. The cause: `Classify Failure` tested the heuristic HTTP rules before our own error codes, so the rules-guardrail issue text "Forbidden claim wording" matched the 403/`Forbidden` pattern. (The pre-restart block test hadn't caught it because only the LLM reviewer flagged that draft, and its wording didn't contain "Forbidden".) The same run also showed that alerts said `Item: n/a` even when an item had been chosen: `$('Parse Page').first()` followed the error branch, which is the one wired to `Classify Failure`.

Fixes in `src/code/classify_failure.js`:
- Explicit codes (`ROBOTS_DISALLOWED`, `NO_NEW_CONTENT`, `PARSE_FAILED`, `GUARDRAIL_BLOCKED`, `CONFIG_ERROR`) are now matched first.
- The context lookup uses `.first(0)`, the success branch.

A regression check was added to `tests/run_unit_tests.mjs`. `tools/sandbox_services.py` also got `/__inject?on=1&sticky=1`, which injects the bad claim into the rewrite as well. The pre-restart block depended on the mock reviewer reading "Cure" in the URL slug, and the mock now strips URLs. Every scenario below was run on the fixed build. The partial pre-fix attempt is kept in `final_regression/pre_fix/`.

| # | Scenario | Result | Evidence (`output/final_regression/…`) |
|---|---|---|---|
| R1 | Dry run, article | ✅ PASS. Article 9795 (cosmetic), 364 chars before link, guardrails passed on attempt 1, simulated `POST /photos`, status `dry_run` | `groupA_dryrun/runs/1.json` |
| R2 | Dry run, Q&A answer | ✅ PASS. Answer 571066 (stem-cell), 424 chars, `dry_run` | `groupA_dryrun/runs/2.json` |
| R3 | Dry run, package | ✅ PASS. Package 8457 (cardiac), 325 chars, `dry_run` | `groupA_dryrun/runs/3.json` |
| R4 | De-duplication | ✅ PASS. The second package run picked 7041, not 8457 again | `groupA_dryrun/runs/4.json` |
| R5 | Guardrail rewrite | ✅ PASS. The injected draft failed attempt 1 (4 rule issues + 2 LLM issues), the rewrite passed attempt 2, then `dry_run` | `groupA_dryrun/runs/5.json` |
| R6 | Guardrail block | ✅ PASS (after the fix). Both attempts failed → `GUARDRAIL_BLOCKED`, run logged `guardrail_blocked` with the draft kept, alert names the item, URL **not** added to `pw_posted` (5 rows for 5 dry runs) | `groupA_dryrun/runs/6.json`, `groupA_dryrun/outbox.jsonl` |
| R7 | Nothing new left | ✅ PASS. `NO_NEW_CONTENT` → `skipped` + alert | `groupA_dryrun/runs/7.json` |
| R8 | Dashboard | ✅ PASS. `GET /webhook/placidway-dashboard` → 200 text/html (dry_run / guardrail_blocked / skipped rows). The pending run showed approve/reject links | `groupA_dryrun/dashboard.html`, `groupB_approval_failures/dashboard_pending.html` |
| R9 | Approval → approve | ✅ PASS. Execution `waiting`, reviewer message with draft + signed links sent to the sink, approve click resumed → `dry_run` publish + `pw_posted` row | `groupB_approval_failures/runs/1.json`, `1_resumed.json`, `outbox.jsonl` |
| R10 | Approval → reject | ✅ PASS. Reject click → `Set Rejected / Expired` → `rejected`, URL remembered so it isn't offered again | `groupB_approval_failures/runs/3.json`, `3_resumed.json` |
| R11 | Site down (503) / retry | ✅ PASS. robots.txt tried 3× at t=0, +5.0 s, +10.0 s → `SOURCE_DOWN` → failed row + alert | `groupB_approval_failures/runs/4.json`, `replay_hits.jsonl` |
| R12 | Cloudflare challenge (simulated) | ✅ PASS. `SOURCE_BLOCKED: Cloudflare "Just a moment" challenge (HTTP 403)` → alert, no bypass | `groupB_approval_failures/runs/5.json` |
| R13 | LIVE (mock Graph), photo post | ✅ PASS. `POST /v24.0/957899504078846/photos` (url + caption, token redacted) → `published`, post ID stored in `pw_runs` + `pw_posted` | `groupC_live_mock_graph/runs/1.json`, `graph_requests.jsonl` |
| R14 | LIVE (mock Graph), link post (`image=none`) | ✅ PASS. `POST /feed` (message + link) → `published` | `groupC_live_mock_graph/runs/2.json` |
| R15 | LIVE (mock Graph), scheduled (`schedule=60`) | ✅ PASS. `/feed` with `published=false`, `scheduled_publish_time` = +60.0 min, `unpublished_content_type=SCHEDULED` → `scheduled` | `groupC_live_mock_graph/runs/3.json` |
| R16 | Token expired (OAuth 190) | ✅ PASS. 3 attempts → `FB_TOKEN_EXPIRED` → failed row + alert with the item and fix steps. URL **not** marked as posted (`pw_posted` has only the 3 successful posts) | `groupC_live_mock_graph/runs/4.json`, `outbox.jsonl` |
| R17 | Export round-trip | ✅ PASS. `n8n export:workflow` of all 3 → `workflows/exported/`. Node count, every node's parameters and the connections are identical to `workflows/*.json`, and `settings.errorWorkflow = PwFbErrorHandl01` is kept | `workflows/exported/` |
| R18 | Unit tests | ✅ PASS. `node tests/run_unit_tests.mjs` → 23 checks | |
| R19 | Secret scan | ✅ PASS. There is no `.env` (only `.env.example`, with empty `LLM_API_KEY` / `FB_PAGE_TOKEN` / `RUN_TOKEN`). `scripts/sandbox.env` holds only the placeholders `mock-key` / `mock-token`, and these never appear in execution output. No key patterns (OpenAI/Anthropic/Groq/OpenRouter, Meta `EAA…`, Slack, GitHub, AWS, Google, private keys) were found. The only `sk-…` matches are PlacidWay URL slugs ("Ask-…") in `research/*.xml` | |

**Not re-run:** the real-site dry run (#16 above). It reads placidway.com, and this regression was kept to replay only, so its earlier result (Cloudflare challenge from the sandbox IP → `SOURCE_BLOCKED`) still stands.

**Known cosmetic issue (not fixed):** errors thrown from Code nodes keep n8n's ` [line N]` suffix in the alert text (e.g. `NO_NEW_CONTENT: … already posted or disallowed [line 49]`). It doesn't affect classification.
