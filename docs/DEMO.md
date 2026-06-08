# Demo runbook — the 3-minute screencast

This is the script you follow while recording the submission demo. Read the words in **bold** as the voiceover; the parentheticals are what to do on screen.

Target length: **3 minutes**. The hackathon rules say "~3 minute demo video" — anywhere between 2:30 and 3:30 is safe. Don't go shorter, judges may dock you for it; don't go longer or they may stop watching.

---

## Before you hit record

1. **Reset state.** Click "Clear all" in the dashboard so the incident list is empty. The demo looks much cleaner starting from zero.
2. **Pick which seeded problems you'll fire.** Recommended sequence:
   - **Hero problem**: `P-2026-05-25-001` (checkout-api latency, rollback case) — the most visually rich (3 tool calls, deploy + log evidence, clear root cause), agent's reasoning lands cleanly on `rollbackDeployment`
   - **Optional second**: `P-2026-05-25-003` (inventory-search autoscaler pinned) — different remediation tool (`scaleService`), shows the agent picks the right tool per problem, not a default
3. **Browser at 1920×1080** (or 1280×720 minimum). Dashboard at full window, no other tabs visible. Hide bookmarks bar.
4. **Audio check.** Record a 5-second test, play it back, confirm clear.
5. **Quiet environment.** Mute notifications. Close Slack, Teams, anything that beeps.
6. **Take 1 is throwaway.** Plan to re-record at least twice. Take 1 finds the rough timing, Take 2 hits it.

## Recording tools (Windows)

| Tool | Pros | Cons |
|---|---|---|
| **OBS Studio** (free) | Best quality, full control, can do picture-in-picture webcam | 30-min learning curve |
| **Loom** | Click-and-record, instant share link, free tier handles 5-min cap easily | Free tier has small watermark |
| **Win+G Game Bar** | Built-in, zero setup | No webcam overlay; audio routing can be finicky |

For a hackathon submission with a strict ~3 min target, **Loom is fastest**. OBS only if you want webcam picture-in-picture.

---

## The script

### [0:00 – 0:25] The problem

(Show dashboard, empty incident list, status pill "live")

> "When a production incident fires at 2 a.m., the on-call engineer spends most of their time on the boring part — pulling logs from Dynatrace, correlating deploys, picking between three obvious remediations. The judgement call — should we actually restart this thing? — takes seconds. The plumbing takes minutes. SRE Sentinel inverts that ratio."
>
> "It's a Gemini-powered agent built with Google's Agent Development Kit. When a Dynatrace problem fires, the agent does the diagnosis work upfront. The human spends five seconds on the only decision that matters: yes or no."

(Hover briefly over the "live" status pill on the right — that's the live SSE connection to the orchestrator)

### [0:25 – 0:40] Firing the first alert

(Hover over the "Simulate a Dynatrace alert" section briefly)

> "Let me show you. Five seeded Dynatrace problems are set up here — each models a different real incident shape. I'll start with response-time degradation on checkout-api."

(Click the **"Response time degradation on checkout-api"** card)

> "Dynatrace just paged us. Response time on the checkout-api service jumped from 220 milliseconds to 4 seconds in six minutes, error rate climbing past 9 percent. Watch what the agent does."

(Wait for the incident to appear in the list. Click into it to open the detail view.)

### [0:40 – 1:40] Watching the agent diagnose

(Reasoning timeline starts filling in. Don't wait — narrate as it streams)

> "The agent is calling the Dynatrace MCP server in real time. Gemini decides which tools to use; ADK routes the calls. First step: pull the full problem record. You can see the affected entity, the severity, the detection signals — high p99 latency, high error rate, CPU saturation flat which rules out load."

(Second turn lands: getDeployments)

> "Now it's checking recent deployments. And there it is — version 2.14.0 of checkout-api went out 11 minutes ago. The problem started a minute later. That's a deploy correlation the agent flags immediately."

(Third turn lands: getLogs — if it streamed; if the agent skipped logs and went straight to proposal, narrate that instead)

> "Logs confirm: connection pool exhaustion right after the deploy, then a fatal error, then the circuit breaker for the postgres connection opens. The new code change pushed pool usage past its limit."

(Final turn: the proposal appears in the right-hand "Proposed action" panel)

> "Three tool calls, six seconds. The agent's proposal: roll back to version 2.13.9. It cites the specific deploy timestamp and the specific log lines as evidence — no hand-waving. Risk level: medium. Blast radius: one service, traffic shifts in 18 seconds."

### [1:40 – 2:15] Human-in-the-loop, modify-and-approve

(Move mouse to the "Edit" button — top-right of the Arguments block in the right panel)

> "Crucially, the operator stays in control. I can click Edit on the arguments. The agent picked v2.14.0 as the current version, but if I had reason to think v2.13.9 is also compromised — say, we'd had a related issue earlier today — I could override the rollback target right here."

(Click "Edit". The args become a textarea. Briefly click into the `reason` field, append something like " Operator-verified.")

> "I'll add an operator note to the audit trail, then approve."

(The amber "modified" badge appears. Button label flips to "Approve with edits". Click it.)

> "Notice the immediate confirmation — the orchestrator's already executing while the SSE stream catches the dashboard up."

(The "Submitted" cyan banner appears, then state transitions to EXECUTING — purple pulse — then RESOLVED with the success banner)

> "Six seconds from alert to proposal. Five seconds for me to review and edit. Four seconds for the remediation MCP to execute the rollback. Total: fifteen seconds from page to resolved."

### [2:15 – 2:45] A second problem to show range

(Click "← All incidents" to go back to the list. Click **"Request queue depth alert on inventory-search"**)

> "One more, to show this isn't a one-trick agent. Same alert pattern, different shape: inventory-search has its request queue depth pinned at the autoscaler maximum. Marketing pushed a banner promotion an hour ago and traffic is three times baseline."

(Wait for the timeline to populate — should reach AWAITING_APPROVAL in ~6 seconds)

> "The agent sees no recent deploys, CPU pinned across all 8 replicas, traffic spike correlated to the campaign — and picks the right tool for this shape: scaleService. Not a restart, not a rollback. The judgement call still belongs to me; the diagnosis is already done."

(Click into the incident to show the scaleService proposal briefly — don't approve, time is tight)

### [2:45 – 3:00] Close

(Briefly show the incident list with both incidents visible, both with their tool tags)

> "Two incidents, two different remediations, both grounded in real evidence from Dynatrace. This is what an agent layer does for SRE — it gives the human the judgement call, not the plumbing call. Code's on GitHub, full Apache 2.0. Thanks for watching."

(Fade or cut)

---

## If something goes wrong mid-take

**The agent gets the wrong answer.** Happens occasionally with Gemini Flash under load (picks restartPod when rollback is clearly right). Click Reject, narrate it as "this is exactly why we keep the human in the loop — Gemini's judgement isn't always right, but the operator's last gate catches it." Then move to the second problem. **Don't pretend it didn't happen** — the human-in-the-loop framing is a feature, not a bug.

**The SSE stream stalls.** Usually a transient Gemini API spike. The dashboard's status pill flips to "reconnecting…" with an amber dot. Refresh the page; the EventSource reconnects and the snapshot replays. Continue narration.

**An incident lands in `FAILED` with a Gemini 503.** Read the friendly error message ("Gemini is rate-limiting us right now…"). Click Clear all, switch to `gemini-2.5-pro` in `.env.local`, retry. Pro is slower but rarely 503s.

**You stumble on a word.** Don't re-record — keep going. Judges will forgive a small stumble. They will not forgive a 5-minute video.

---

## Post-recording

1. **Trim** — cut anything before "When a production incident fires" and after the second incident's proposal.
2. **No music.** Voiceover only.
3. **Captions optional but high-leverage** — many judges watch with sound off on a first pass. Loom and YouTube both auto-generate good-enough captions.
4. **Upload to YouTube as unlisted** OR keep on Loom. Either is fine for Devpost. Don't upload to Google Drive — judges find that fiddly.
5. **Update the README** with the video link.

## Talking points to keep handy (for Devpost write-up or any Q&A)

- **Why Gemini specifically?** Native function-calling, free tier on AI Studio for development, Vertex AI endpoint for production, native fit with the hackathon's preferred stack.
- **Why ADK?** It's the Google Cloud Agent Builder code-first SDK. We get a managed agent loop, native MCP integration via `MCPToolset`, and deployment flexibility — local, Cloud Run, Agent Engine, or anywhere a Node container runs.
- **Why MCP?** Tool integration without writing tenant-specific glue. Same protocol for the Dynatrace MCP server (the partner's product) and our custom Remediation MCP. The agent doesn't care that they're different products.
- **Why human-in-the-loop?** A wrong rollback in production is worse than a slow rollback. The agent does the work the human is bad at (correlating signals under time pressure); the human does the work the agent is bad at (judgement on partial information).
- **Could you skip the human?** Technically yes — remove the approval gate, route `AWAITING_APPROVAL` straight to `EXECUTING`. We deliberately don't because that's how you get incidents where the agent confidently makes things worse. Two engineers cited that incident on the architecture review.
- **What's mocked vs real?** Diagnosis: real Dynatrace MCP server (or an in-process mock with realistic fixtures for offline development). Remediation: `restartPod` REAL mode wired but pointing at a sacrificial target; rollback and scale return realistic-shaped responses with realistic timing. All clearly logged in the audit trail.
- **Why this matters for the partner track?** Dynatrace's MCP server gives the agent grounded observability data — problems, deployments, logs, entities — without us writing API glue. The agent picks tools at runtime; the partner provides the superpowers. That's the literal hackathon framing.
- **Production-readiness gaps you'd close?** The remediation MCP is mock-first for safety; production swaps each to a real target. SQLite audit log → Firestore for multi-instance. Single shared password → OAuth. Webhook auth → HMAC-signature instead of static bearer. None of these change the agent design.
