# Demo runbook — the 90-second screencast

This is the script you follow while recording the submission demo. Read the words in **bold** as the voiceover; the parentheticals are what to do on screen.

Target length: **90 seconds**. If you go over 100 seconds, cut.

---

## Before you hit record

1. **Reset state.** Click "clear all" in the dashboard so the incident list is empty. The demo looks much cleaner starting from zero.
2. **Pick which seeded problem to use as the hero.** Recommended: `P-2026-05-25-001` (checkout-api latency, rollback case) — it's the most visually rich (3 tool calls, real-looking deploy + log evidence) and the agent's reasoning lands cleanly.
3. **Browser at 1920×1080** (or 1280×720 if your screen is smaller). Dashboard at full window, no other tabs visible. Hide bookmarks bar.
4. **Audio check.** Record a 5-second test, play it back, confirm clear.
5. **Quiet environment.** Mute notifications. Close Slack, Teams, anything that beeps.
6. **Take 1 is throwaway.** Plan to re-record at least twice. Take 1 finds the rough timing, Take 2 hits it.

## Recording tools (Windows)

| Tool | Pros | Cons |
|---|---|---|
| **OBS Studio** (free) | Best quality, full control | 30-minute learning curve |
| **Loom** | Click-and-record, instant share link | Free tier has watermark + 5-min cap (fine for us) |
| **Win+G Game Bar** | Built-in, zero setup | No webcam overlay; audio routing can be finicky |

For a hackathon submission, **Loom is fastest**. OBS only if you want webcam picture-in-picture.

---

## The script

### [0:00 – 0:10] Hook

(Show dashboard, empty incident list, status pill "live")

> "When a production incident fires at 2 a.m., the on-call engineer spends most of their time on the boring part — pulling logs, correlating deploys, picking a remediation. SRE Sentinel does that work upfront. The human spends five seconds on the only decision that matters."

### [0:10 – 0:20] Fire the alert

(Click the "Response time degradation on checkout-api" card under "Simulate a Dynatrace alert")

> "Dynatrace just paged. Response time on checkout-api jumped from 220 milliseconds to 4 seconds. Watch what the agent does."

(Wait for the incident to appear in the list. Click into it to open the detail view.)

### [0:20 – 0:55] Watch the agent diagnose

(Reasoning timeline starts filling in: getProblem → getDeployments → getLogs)

> "Gemini is calling the Dynatrace MCP server in real time. First, it pulls the full problem record. Then it checks recent deployments — and there it is, v2.14.0 went out eleven minutes ago, right when latency started spiking. It pulls the logs to confirm: connection pool exhaustion, circuit breaker tripped on the new code path."

(Each tool call streams in over SSE — you don't need to wait for the agent to finish before talking; the timeline visually catches up to your narration)

### [0:55 – 1:05] The proposal

(Approval panel populates; rationale visible)

> "The agent's proposal: roll back to v2.13.9. Risk: low. Blast radius: one service, traffic shifts in 18 seconds. Crucially, the rationale cites the specific deploy timestamp and the specific log lines that led to it — no hand-waving."

### [1:05 – 1:20] The human decision

(Hover over the rationale; if you want, click "edit" to show the args are editable, then "reset")

> "I can edit the args here if I want — useful when the agent's right about the action but slightly off on the target. Or I just approve."

(Click "Approve & execute")

### [1:20 – 1:30] Resolution + close

(Watch state move to EXECUTING → RESOLVED)

> "Six seconds from alert to proposal. Five seconds for me to read it. Four seconds for the remediation. Twenty seconds total versus the typical five minutes. This is what an agent layer does for SRE — it gives the human the *judgement* call, not the *plumbing* call."

(Fade or cut)

---

## What if something goes wrong mid-take?

**The agent gets the wrong answer.** Happens occasionally with Gemini Flash under load (it picks restartPod when rollback is clearly right). Click "Reject", clear state, try a different seeded problem. Don't pretend it didn't happen.

**The SSE stream stalls.** Usually a transient Gemini API spike. Refresh the page (the EventSource auto-reconnects), the incident state will be wherever it was. Continue narration.

**An incident lands in `FAILED`.** Read the outcome summary — it'll say what went wrong ("Diagnosis aborted: reached 6-turn cap" or "Final response was not a valid remediation proposal"). Show it; it demonstrates the orchestrator's failure handling. Then click clear-all and start over.

**You stumble on a word.** Don't re-record — keep going. The judges will forgive a small stumble. They will not forgive a 4-minute video.

---

## Post-recording

1. **Trim** — cut anything before "When a production incident fires" and after the resolution.
2. **No music.** Voiceover only. Music in a 90-second demo is noise.
3. **Caption optional but high-leverage** — judges may watch with sound off on a first pass. Auto-captions in Loom / YouTube are good enough.
4. **Upload to YouTube as unlisted** OR keep on Loom. Either is fine. Don't upload to Google Drive — judges find that fiddly.
5. **Update the README** with the video link.

## Talking points to keep handy (for any Q&A)

- "Why Gemini specifically?" → Function-calling support, free tier in AI Studio for dev, Vertex AI for prod, judges' track preference.
- "Why MCP?" → Tool integration without writing tenant-specific glue. Same protocol for the Dynatrace tools and our custom remediation server.
- "Why human-in-the-loop?" → A wrong rollback in production is worse than a slow rollback. The agent does the work the human is bad at (correlating signals); the human does the work the agent is bad at (judgement under uncertainty).
- "Could you skip the human?" → Yes, easily — remove the approval gate, route `AWAITING_APPROVAL` straight to `EXECUTING`. We deliberately don't because that's how you get incidents where the agent confidently makes things worse.
- "What's mocked vs real?" → Diagnosis: real Dynatrace MCP (or in-process mock with seeded fixtures). Remediation: `restartPod` real-mode wired but pointing at a sacrificial Cloud Run target; rollback and scale return realistic-shaped data with realistic timing. All clearly logged in the audit trail.
