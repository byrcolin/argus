// Copyright 2026 Colin Byron. Apache-2.0 license.

/**
 * Email templates — structured HTML/text templates for Argus notifications.
 */

import type { TrackedIssue, IssueEvaluation, PRAnalysis, CodingIteration } from '../agent/types';

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function issueEvaluated(issue: TrackedIssue, evaluation: IssueEvaluation): { subject: string; text: string; html: string } {
    const verdict = evaluation.merit ? 'APPROVED' : 'REJECTED';
    return {
        subject: `[Argus] Issue #${issue.issueNumber} ${verdict}: ${issue.title}`,
        text: `Argus evaluated issue #${issue.issueNumber}: ${issue.title}\n\nVerdict: ${verdict}\nCategory: ${evaluation.category}\nSeverity: ${evaluation.severity}\nConfidence: ${(evaluation.confidence * 100).toFixed(0)}%\n\nReasoning:\n${evaluation.reasoning}\n\nURL: ${issue.url}`,
        html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px;">
  <h2 style="color: ${evaluation.merit ? '#22863a' : '#cb2431'};">
    ${evaluation.merit ? '✅' : '❌'} Issue #${issue.issueNumber} ${verdict}
  </h2>
  <p><strong>${escapeHtml(issue.title)}</strong></p>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 4px 8px; border: 1px solid #e1e4e8;">Category</td><td style="padding: 4px 8px; border: 1px solid #e1e4e8;">${evaluation.category}</td></tr>
    <tr><td style="padding: 4px 8px; border: 1px solid #e1e4e8;">Severity</td><td style="padding: 4px 8px; border: 1px solid #e1e4e8;">${evaluation.severity}</td></tr>
    <tr><td style="padding: 4px 8px; border: 1px solid #e1e4e8;">Confidence</td><td style="padding: 4px 8px; border: 1px solid #e1e4e8;">${(evaluation.confidence * 100).toFixed(0)}%</td></tr>
  </table>
  <h3>Reasoning</h3>
  <p>${escapeHtml(evaluation.reasoning)}</p>
  <p><a href="${issue.url}">View Issue →</a></p>
</div>`,
    };
}

export function prCreated(issue: TrackedIssue, iterations: CodingIteration[]): { subject: string; text: string; html: string } {
    const lastCI = iterations[iterations.length - 1]?.ciResult;
    return {
        subject: `[Argus] PR #${issue.prNumber} opened for issue #${issue.issueNumber}`,
        text: `Argus created PR #${issue.prNumber} for issue #${issue.issueNumber}: ${issue.title}\n\nIterations: ${iterations.length}\nCI: ${lastCI || 'unknown'}\n\nPR URL: ${issue.prUrl}\nIssue URL: ${issue.url}`,
        html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px;">
  <h2>📤 PR #${issue.prNumber} Opened</h2>
  <p>For issue #${issue.issueNumber}: <strong>${escapeHtml(issue.title)}</strong></p>
  <ul>
    <li>Iterations: ${iterations.length}</li>
    <li>CI: ${lastCI === 'passing' ? '✅ Passing' : lastCI === 'failing' ? '❌ Failing' : '⏳ Pending'}</li>
  </ul>
  <p><a href="${issue.prUrl}">View PR →</a> · <a href="${issue.url}">View Issue →</a></p>
</div>`,
    };
}

export function threatDetected(
    repo: string,
    username: string,
    classification: string,
    confidence: number,
    actions: string[],
): { subject: string; text: string; html: string } {
    return {
        subject: `[Argus] ⚠️ Threat detected in ${repo} by @${username}`,
        text: `Argus detected a ${classification} threat in ${repo}.\n\nUser: @${username}\nClassification: ${classification}\nConfidence: ${(confidence * 100).toFixed(0)}%\nActions: ${actions.join(', ')}`,
        html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px;">
  <h2 style="color: #cb2431;">⚠️ Threat Detected</h2>
  <p>In <strong>${escapeHtml(repo)}</strong> by <strong>@${escapeHtml(username)}</strong></p>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 4px 8px; border: 1px solid #e1e4e8;">Classification</td><td style="padding: 4px 8px; border: 1px solid #e1e4e8; color: #cb2431;">${classification}</td></tr>
    <tr><td style="padding: 4px 8px; border: 1px solid #e1e4e8;">Confidence</td><td style="padding: 4px 8px; border: 1px solid #e1e4e8;">${(confidence * 100).toFixed(0)}%</td></tr>
    <tr><td style="padding: 4px 8px; border: 1px solid #e1e4e8;">Actions</td><td style="padding: 4px 8px; border: 1px solid #e1e4e8;">${actions.join(', ')}</td></tr>
  </table>
</div>`,
    };
}

export function competingPRsAnalyzed(
    issue: TrackedIssue,
    analyses: PRAnalysis[],
): { subject: string; text: string; html: string } {
    const ranked = [...analyses].sort((a, b) => b.overallScore - a.overallScore);
    return {
        subject: `[Argus] ${analyses.length} competing PR(s) analyzed for #${issue.issueNumber}`,
        text: `Argus analyzed ${analyses.length} competing PRs for issue #${issue.issueNumber}.\n\n${
            ranked.map((pr, i) => `${i + 1}. PR #${pr.prNumber} by @${pr.author}: ${(pr.overallScore * 100).toFixed(0)}%`).join('\n')
        }`,
        html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px;">
  <h2>⚔️ Competing PRs for #${issue.issueNumber}</h2>
  <ol>
    ${ranked.map((pr) => `<li><strong>PR #${pr.prNumber}</strong> by @${escapeHtml(pr.author)} — ${(pr.overallScore * 100).toFixed(0)}% ${pr.ciPassing ? '✅' : '❌'}</li>`).join('\n    ')}
  </ol>
  <p><a href="${issue.prUrl}">View Our PR →</a></p>
</div>`,
    };
}

export function pipelineError(
    issueNumber: number,
    repo: string,
    error: string,
): { subject: string; text: string; html: string } {
    return {
        subject: `[Argus] ❗ Pipeline error on #${issueNumber} in ${repo}`,
        text: `Argus encountered an error processing issue #${issueNumber} in ${repo}.\n\nError: ${error}`,
        html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px;">
  <h2 style="color: #cb2431;">❗ Pipeline Error</h2>
  <p>Issue #${issueNumber} in <strong>${escapeHtml(repo)}</strong></p>
  <pre style="background: #f6f8fa; padding: 12px; border-radius: 6px; overflow-x: auto;">${escapeHtml(error)}</pre>
</div>`,
    };
}
