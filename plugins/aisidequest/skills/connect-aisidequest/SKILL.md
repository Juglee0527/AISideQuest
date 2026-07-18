---
name: connect-aisidequest
description: Connect or reconnect the installed AISideQuest Codex plugin to the user's AISideQuest account through browser approval. Use when the user asks to connect AISideQuest, link this Codex device, reconnect the plugin, or avoid the legacy one-time-code and PowerShell flow.
---

# Connect AISideQuest

Connect without asking the user to copy a code or run another connection command. AISideQuest is local-first, so the developer must already have the repository's `npm.cmd run dev:local` process running. The script creates local-only credentials, verifies the approval web is reachable, opens it, waits for approval, and stores the device configuration.

## Workflow

1. Resolve the plugin root as two directories above this `SKILL.md` file.
2. Tell the user that the AISideQuest approval page will open and that they only need to click **이 기기 연결 승인**. This commentary is required because the command waits for browser approval.
3. Run `node "<plugin-root>/scripts/connect-device.mjs"` from the plugin root. Do not add `--code` unless the user explicitly requests the legacy recovery flow.
4. Wait for the command to finish. Do not print, copy, summarize, or request the verifier, device token, request body, or local configuration contents.
5. After a successful connection, run `node "<plugin-root>/scripts/send-test-event.mjs"` once to verify device authentication and delivery.
6. Report that the connection and test event succeeded. If the script says the local API or approval web is unavailable, tell the user to keep `npm.cmd run dev:local` running and retry once. If the browser cannot open or the request expires, report the concise script error and retry the same workflow once with a fresh request.

## Safety

- Never request a GitHub credential, browser cookie, one-time connection code, verifier, or device token from the user.
- Never read or display `device.json` contents.
- Never collect or transmit prompts, AI responses, source code, diffs, transcripts, tool input/output, or local paths.
- Keep `--code` support as a recovery-only fallback; do not present it as the normal flow.
