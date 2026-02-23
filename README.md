# Argus — AI Issue Agent

> *The hundred-eyed watchman that never sleeps.*

A VS Code extension that autonomously triages GitHub/GitLab issues, investigates code, creates branches, and opens pull requests with full AI reasoning transcripts. Adversary-aware. Cryptographically stamped. Never merges.

## Features

- **Issue Triage** — Polls repos for new issues, evaluates technical merit using Copilot LM API
- **Code Investigation** — Reads relevant source files, searches for error patterns, builds context
- **Autonomous Coding** — Creates branches, iterates on fixes, monitors CI results
- **Pull Request Management** — Opens PRs with detailed reasoning transcripts as comments
- **Competitive PR Analysis** — Evaluates competing PRs, ranks solutions, synthesizes super PRs
- **12-Layer Security** — Input sanitization, cryptographic LLM framing, threat classification, session isolation, output validation, HMAC stamps, tamper detection, scope-locked tokens, rate limiting, chained audit log, watchdog timers, multi-instance sovereignty
- **Graduated Trust Model** — Role-aware, history-informed user trust with proportional response
- **Multi-Forge** — GitHub and GitLab from a single abstraction
- **Email Notifications** — Configurable per-event with SMTP support
- **Cryptographic Identity** — HMAC-SHA256 stamps on every artifact, anti-replay nonces

## Quick Start

1. Install the extension
2. Configure repos in settings (`argus.repos`)
3. Set up authentication tokens (prompted on first run)
4. Click **Start** in the Argus sidebar panel

## Architecture

```
src/
├── extension.ts          # Activation, commands, polling setup
├── forge/                # Multi-forge abstraction (GitHub + GitLab)
├── agent/                # Issue evaluation, coding, PR analysis
├── security/             # Sanitization, threat classification, trust
├── crypto/               # HMAC stamps, key management, audit log
├── notifications/        # Email system
├── ui/                   # TreeView, status bar, notifications
└── util/                 # Config, queue, logger, rate limiter
```

## Security Model

Argus operates under a zero-trust model. All user-generated content (issues, comments, PR descriptions) is treated as potentially adversarial. See [SECURITY.md](SECURITY.md) for the full 12-layer defense architecture.

## License

Apache-2.0
