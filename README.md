# Argus — AI Issue Agent

> *The hundred-eyed watchman that never sleeps.*

A VS Code extension that autonomously triages GitHub/GitLab issues, investigates code, creates branches, and opens pull requests with full AI reasoning transcripts. Adversary-aware. Cryptographically stamped. Never merges.

## Features

- **Issue Triage** — Polls repos for new issues, evaluates technical merit using Copilot LM API
- **Agentic Evaluation** — Multi-turn LLM exploration of the full codebase via READ_FILES protocol before rendering judgment
- **Code Investigation** — Reads relevant source files, searches for error patterns, builds context
- **Autonomous Coding** — Creates branches, iterates on fixes, monitors CI results
- **Pull Request Management** — Opens PRs with detailed reasoning transcripts as comments
- **Issue Acknowledgment** — Posts stamped comments on issues linking to the PR, with category/severity/approach
- **Comment Monitoring** — Watches for new issue comments, runs moderation, logs clean feedback on the PR
- **PR Review Feedback** — Reads and acknowledges inline review comments (e.g., from GitHub Copilot, human reviewers)
- **Competitive PR Analysis** — Evaluates competing PRs, ranks solutions, synthesizes super PRs
- **Smart Skip Logic** — Avoids re-processing issues where Argus already has the last word
- **Confidence Safety Net** — Low-confidence rejections auto-flip to accepted for investigation
- **12-Layer Security** — Input sanitization, cryptographic LLM framing, threat classification, session isolation, output validation, HMAC stamps, tamper detection, scope-locked tokens, rate limiting, chained audit log, watchdog timers, multi-instance sovereignty
- **Graduated Trust Model** — Role-aware, history-informed user trust with proportional response
- **Multi-Forge** — GitHub and GitLab from a single abstraction
- **Token Management** — Set, clear, and list authentication tokens from the command palette
- **Email Notifications** — Configurable per-event with SMTP support
- **Cryptographic Identity** — HMAC-SHA256 stamps on every artifact, anti-replay nonces

## Quick Start

1. Install the extension
2. Open the command palette and run **Argus: Set GitHub Token** (or GitLab)
3. Add repos via **Argus: Add Repository** or configure `argus.repos` in settings
4. Click **Start** in the Argus sidebar panel

### Required GitHub PAT Permissions (Fine-Grained)

| Permission | Access | Why |
|---|---|---|
| Contents | Read & Write | Read code, create branches, commit files |
| Issues | Read & Write | Read issues, add labels, post comments |
| Pull requests | Read & Write | Create PRs, post review acknowledgments |
| Commit statuses | Read | Monitor CI results |

## Architecture

```
src/
├── extension.ts          # Activation, commands, token management, polling
├── forge/                # Multi-forge abstraction (GitHub + GitLab)
│   ├── types.ts          # Forge interface, Issue, Comment, ReviewComment, PR types
│   ├── github.ts         # GitHub implementation via @octokit/rest
│   ├── gitlab.ts         # GitLab implementation via REST API v4
│   └── factory.ts        # Forge creation, token helpers
├── agent/                # Issue evaluation, coding, PR analysis
│   ├── evaluator.ts      # Multi-turn agentic evaluation with READ_FILES protocol
│   ├── investigator.ts   # Code search, file-level analysis
│   ├── coder.ts          # Iterative LLM code generation + CI loop
│   ├── pipeline.ts       # Main orchestrator — poll → evaluate → code → PR → monitor
│   ├── transcriber.ts    # Formats AI reasoning as structured PR comments
│   ├── comment-handler.ts # Comment moderation with threat assessment
│   ├── edit-detector.ts  # Detects mid-flight issue edits
│   └── pr-analyzer.ts    # Competitive PR analysis & synthesis
├── security/             # Sanitization, threat classification, trust model
├── crypto/               # HMAC-SHA256 stamps, key management, audit log
├── notifications/        # Email system (SMTP)
├── ui/                   # TreeView, status bar, webview panels
└── util/                 # Config, queue, logger, rate limiter
```

## Pipeline Flow

```
Poll repo → Skip if last word → Evaluate (multi-turn) → Create branch
  → Investigate → Code (iterative + CI) → Create PR → Post transcription
  → Acknowledge issue → Monitor issue comments → Monitor PR review comments
  → Analyze competing PRs → Optionally synthesize super PR
```

## Security Model

Argus operates under a zero-trust model. All user-generated content (issues, comments, PR descriptions) is treated as potentially adversarial. See [SECURITY.md](SECURITY.md) for the full 12-layer defense architecture.

## License

Dual-licensed under Apache-2.0 and MIT. See [LICENSE_APACHE2.TXT](LICENSE_APACHE2.TXT) and [LICENSE_MIT.TXT](LICENSE_MIT.TXT).
