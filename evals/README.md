# Offline agent evaluations

Run `npm run eval` from `backend/`. It executes 33 synthetic scenarios with scripted customer turns, a scripted model, and controlled MCP responses, writes the generated artifacts below, and automatically uploads that run as a LangSmith experiment. It requires `LANGSMITH_API_KEY`. The scenarios still execute locally because they exercise this repo's code; LangSmith stores and displays their results. They do not call the configured LLM or write to the live booking database.

- `results/latest.md`: generated scenario, expected, actual, pass/fail, notes table.
- `results/latest.json`: machine-readable results and run timestamps.
- `results/traces.json`: one sanitized state/tool/model event record for each scenario.
- `results/example-trace.json`: one sanitized, synthetic approval trace with state transitions, tool name, filtered arguments/result, and latency.

The process exits nonzero if any scenario fails. Assertions inspect approval records, MCP calls, request submissions, and action outcomes, in addition to replies. Scripted replies verify application paths; they do not score the semantic quality of a live LLM.

## Assignment coverage

| Required case | Coverage | Evidence or remaining work |
| --- | --- | --- |
| At least 20 automated scenarios | Covered | 33 generated rows in `results/latest.md`. |
| Invariant: no booking without valid approval | Covered for the agent service | Unknown, unconfirmed, expired, and plain-chat approval attempts cause no request submission. Provider confirmation is separate from the customer's request. These use a fake repository, not a live database. |
| Adversarial input | Covered for approval bypass | Plain-chat instruction cannot submit a booking; invalid approval IDs and confirmation flags are rejected. |
| Prompt injection | Partial | A malicious review is treated as tool data without a write. A live-model attack set is still needed to measure whether the model follows injected text. |
| Changed price or slot after approval | Covered | Revalidation returns `details_changed` with no request submission. |
| Booking timeout after possible success | Partial | A fake repository simulates a committed request whose response was lost, then an idempotent retry after service restart. A real database timeout and recovery trace remain untested. |
| Slot conflict | Covered for preparation and reschedule | Failed hold creates no approval; failed reschedule preserves the original booking in the fake repository. |
| Repeated confirmation | Covered | Two approval calls produce one unique request in the fake repository. |
| Memory correction and forgetting | Missing | The current agent has session summaries but no explicit preference inspect, correct, or forget API. |
| Restart mid-booking | Partial | A new service instance can use the saved fake approval; actual process/database restart recovery remains untested. |
| Proactive cancellation | Missing | Provider cancellation event handling and replacement suggestions are not implemented. Customer-requested cancellation and retry are covered. |
| Context budget | Partial | 50 synthetic facts trigger message-count compaction, but there is no measured token cap or fact-retention score. |
| Limit exhaustion | Covered for MCP calls | The ten-call tool limit is exercised. Model-turn and wall-clock limits need explicit scenarios. |
| Tool failures | Covered for discovery, search, hold, and status calls | Fake MCP failures produce bounded outcomes without booking writes. |

This is an offline regression suite for the implemented paths. Completing every assignment item also requires explicit preference memory, provider cancellation handling, a measured context budget, and live-model or real-database evaluations for the partial rows.

Use `npm run eval:offline` when you want only local artifacts or have no LangSmith key. `npm run eval:upload` retries an upload of the latest local run without rerunning scenarios. Each upload creates a new LangSmith experiment and writes its dataset/experiment IDs to `results/langsmith-upload.json`. Failed scenarios are uploaded too, while the eval command exits nonzero. Uploads contain scenario names, expected/actual outcomes, pass scores and timings; they exclude prompts, customer records, slot tokens and full traces.

Live chat traces use Mastra's LangSmith exporter when `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` is set. Set `LANGCHAIN_PROJECT` to select the LangSmith project. Model prompts and completions are redacted before export; tool spans keep safe filters and status while hiding account IDs, slot tokens, reviews, and contact data. Mastra model spans provide timing and token/cost metrics when the model reports them. The application adds state transitions and direct MCP calls around the Mastra run.
