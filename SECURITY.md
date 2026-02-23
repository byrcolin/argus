# Security Policy

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in Argus, please report it responsibly.

### How to Report

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Email the maintainers directly with details of the vulnerability
3. Include as much information as possible:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- We will do our best to acknowledge receipt within 48 hours
- We will do our best investigate and provide updates on the fix timeline
- We will credit you in the security advisory (unless you prefer to remain anonymous)

## Supported Versions

As this project is in early development, only the latest version is supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Security Best Practices

When using Argus:

1. **PAT Tokens**: Never commit GitHub/GitLab tokens to the repository. Argus stores them in VS Code SecretStorage.
2. **Audit Trail**: Review the cryptographic audit log periodically for unexpected actions.
3. **Trust Model**: Argus uses a graduated trust model — new repos start at the lowest tier. Promote deliberately.
4. **Dependencies**: Keep dependencies up to date.
5. **Never Merges**: Argus never merges its own PRs. A human must always approve and merge.
