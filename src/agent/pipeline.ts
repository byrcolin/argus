// Copyright 2026 Colin Byron. Apache-2.0 license.

/**
 * Pipeline — the main orchestrator that drives Argus's issue processing.
 *
 * Flow:
 *  1. Poll for new issues
 *  2. Evaluate each issue (LLM merit assessment)
 *  3. Investigate (code search, file reads)
 *  4. Create branch
 *  5. Code (iterative LLM generation + CI check loop)
 *  6. Create PR with full transcription
 *  7. Monitor comments
 *  8. Analyze competing PRs
 *  9. Optionally synthesize a "super PR"
 */

import { createHash } from 'crypto';
import type { Forge, Issue, RepoKey } from '../forge/types';
import {
    TrackedIssue,
    IssueState,
    IssueSession,
    ActivityEntry,
} from './types';
import { Evaluator } from './evaluator';
import { Investigator } from './investigator';
import { Coder } from './coder';
import { Transcriber } from './transcriber';
import { CommentHandler } from './comment-handler';
import { EditDetector } from './edit-detector';
import { PRAnalyzer } from './pr-analyzer';
import type { StampManager } from '../crypto/stamp';
import type { AuditLog } from '../crypto/audit';
import type { Logger } from '../util/logger';

export interface PipelineConfig {
    maxConcurrentIssues: number;
    maxCodingIterations: number;
    commentCheckInterval: number;  // ms
    prPrefix: string;              // e.g., "argus/"
    branchPrefix: string;
    dryRun: boolean;
}

const DEFAULT_CONFIG: PipelineConfig = {
    maxConcurrentIssues: 3,
    maxCodingIterations: 5,
    commentCheckInterval: 60_000,
    prPrefix: '',
    branchPrefix: 'argus/',
    dryRun: false,
};

export class Pipeline {
    private workQueue: TrackedIssue[] = [];
    private activity: ActivityEntry[] = [];
    private sessions = new Map<string, IssueSession>();
    private config: PipelineConfig;

    // Track last poll time per repo
    private lastPollTimes = new Map<RepoKey, Date>();

    constructor(
        private readonly evaluator: Evaluator,
        private readonly investigator: Investigator,
        private readonly coder: Coder,
        private readonly transcriber: Transcriber,
        private readonly commentHandler: CommentHandler,
        private readonly editDetector: EditDetector,
        private readonly prAnalyzer: PRAnalyzer,
        private readonly stampManager: StampManager,
        private readonly auditLog: AuditLog,
        private readonly logger: Logger,
        config?: Partial<PipelineConfig>,
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    // ─── Public API ─────────────────────────────────────────────────

    /** Poll a repo for new issues and enqueue them. */
    async pollRepo(forge: Forge): Promise<number> {
        const repoKey: RepoKey = `${forge.platform}:${forge.owner}/${forge.repo}`;
        const since = this.lastPollTimes.get(repoKey) || new Date(Date.now() - 24 * 60 * 60 * 1000);

        this.logger.info(`Polling ${repoKey} for issues since ${since.toISOString()}`);

        const issues = await forge.listNewIssues(since);
        this.lastPollTimes.set(repoKey, new Date());

        let enqueued = 0;
        for (const issue of issues) {
            if (this.isAlreadyTracked(issue)) {
                continue;
            }

            // Skip if Argus has the last word (no new comments since our last stamp)
            if (await this.argusHasLastWord(forge, issue.number)) {
                this.logger.info(`Skipping issue #${issue.number} — Argus has the last word`);
                continue;
            }

            const tracked: TrackedIssue = {
                issueNumber: issue.number,
                repo: repoKey,
                title: issue.title,
                url: issue.url,
                state: 'pending',
                createdAt: issue.createdAt,
                bodyHash: createHash('sha256').update(issue.body || '').digest('hex'),
                currentIteration: 0,
                maxIterations: this.config.maxCodingIterations,
            };

            this.workQueue.push(tracked);
            this.addActivity(repoKey, issue.number, undefined, '📥', `Enqueued issue #${issue.number}: ${issue.title}`, issue.url);
            enqueued++;
        }

        await this.auditLog.append({
            action: 'poll_repos',
            repo: `${forge.owner}/${forge.repo}`,
            target: repoKey,
            input: since.toISOString(),
            output: String(issues.length),
            decision: `Found ${issues.length} issues, enqueued ${enqueued}`,
            llmCallCount: 0,
            details: `Poll ${repoKey}`,
        });

        return enqueued;
    }

    /** Process the next issue in the work queue. */
    async processNext(forge: Forge): Promise<TrackedIssue | undefined> {
        const next = this.workQueue.find((i) => i.state === 'pending');
        if (!next) {
            return undefined;
        }

        // Check concurrent limit
        const active = this.workQueue.filter((i) =>
            !['pending', 'done', 'skipped', 'flagged', 'stuck', 'rejected'].includes(i.state)
        );
        if (active.length >= this.config.maxConcurrentIssues) {
            this.logger.debug(`Concurrent limit reached (${active.length}/${this.config.maxConcurrentIssues})`);
            return undefined;
        }

        return await this.processIssue(forge, next);
    }

    /** Process a specific issue through the full pipeline. */
    async processIssue(forge: Forge, issue: TrackedIssue): Promise<TrackedIssue> {
        const sessionKey = `${issue.repo}:${issue.issueNumber}`;
        const session: IssueSession = {
            issueNumber: issue.issueNumber,
            repo: issue.repo,
            startedAt: new Date(),
            llmConversationHistory: [],
            filesRead: [],
            filesModified: [],
            stampsGenerated: [],
            noncesUsed: [],
            llmCallCount: 0,
            aborted: false,
        };
        this.sessions.set(sessionKey, session);
        issue.startedAt = new Date();

        try {
            // ── Step 1: Evaluate ──
            issue.state = 'evaluating';
            this.addActivity(issue.repo, issue.issueNumber, undefined, '🔍', `Evaluating issue #${issue.issueNumber}`);
            this.logger.info(`Evaluating issue #${issue.issueNumber}: ${issue.title}`);

            const evaluation = await this.evaluator.evaluate(forge, await forge.getIssue(issue.issueNumber));
            issue.evaluation = evaluation;

            await this.auditLog.append({
                action: 'evaluate_issue',
                repo: `${forge.owner}/${forge.repo}`,
                target: issue.url,
                input: issue.bodyHash,
                output: JSON.stringify(evaluation),
                decision: evaluation.merit ? 'approved' : 'rejected',
                llmCallCount: 1,
                details: evaluation.reasoning.substring(0, 200),
            });

            if (!evaluation.merit) {
                // Safety net: low-confidence rejections get flipped to approved
                if (evaluation.confidence < 0.7) {
                    this.logger.warn(
                        `Overriding low-confidence rejection for #${issue.issueNumber} ` +
                        `(confidence: ${evaluation.confidence.toFixed(2)}) — accepting for investigation`,
                    );
                    evaluation.merit = true;
                    evaluation.reasoning = `[Auto-accepted: low confidence rejection overridden] ${evaluation.reasoning}`;
                    evaluation.suggestedLabels = [...(evaluation.suggestedLabels || []), 'argus:low-confidence-override'];
                } else {
                    issue.state = 'rejected';
                    this.addActivity(issue.repo, issue.issueNumber, undefined, '❌', `Rejected issue #${issue.issueNumber}: ${evaluation.reasoning.substring(0, 100)}`);
                    return issue;
                }
            }

            issue.state = 'approved';
            this.addActivity(issue.repo, issue.issueNumber, undefined, '✅', `Approved issue #${issue.issueNumber} (${evaluation.category}/${evaluation.severity})`);

            // ── Step 2: Create branch ──
            issue.state = 'branching';
            const defaultBranch = await forge.getDefaultBranch();
            const branchName = `${this.config.branchPrefix}issue-${issue.issueNumber}`;
            issue.branchName = branchName;

            if (!this.config.dryRun) {
                await forge.createBranch(defaultBranch, branchName);
            }
            this.addActivity(issue.repo, issue.issueNumber, undefined, '🌿', `Created branch ${branchName}`);

            // ── Step 3: Investigate ──
            this.logger.info(`Investigating codebase for issue #${issue.issueNumber}`);
            const investigation = await this.investigator.investigate(forge, evaluation, defaultBranch);

            // ── Step 4: Code ──
            issue.state = 'coding';
            this.addActivity(issue.repo, issue.issueNumber, undefined, '🔧', `Coding solution for issue #${issue.issueNumber}`);

            // Check for edits before coding
            const editCheck = await this.editDetector.check(forge, issue);
            if (editCheck.detected && editCheck.action === 'halt') {
                issue.state = 'flagged';
                issue.error = editCheck.reason;
                this.addActivity(issue.repo, issue.issueNumber, undefined, '🚨', `HALTED: ${editCheck.reason}`);
                return issue;
            }

            const iterations = this.config.dryRun ? [] : await this.coder.code(forge, issue, evaluation, investigation);

            // ── Step 5: Create PR ──
            const lastIteration = iterations[iterations.length - 1];
            const ciPassed = lastIteration?.ciResult === 'passing';

            if (!this.config.dryRun && iterations.length > 0) {
                issue.state = 'pr-open';
                const prTitle = `${evaluation.category}: ${issue.title} (fixes #${issue.issueNumber})`;
                const prBody = await this.buildPRBody(issue, evaluation, iterations);

                const pr = await forge.createPullRequest(
                    branchName,
                    defaultBranch,
                    prTitle,
                    prBody,
                );

                issue.prNumber = pr.number;
                issue.prUrl = pr.url;

                // Post transcription comments
                await this.transcriber.postEvaluation(forge, pr.number, issue, evaluation);
                await this.transcriber.postInvestigation(forge, pr.number, investigation);
                for (const it of iterations) {
                    await this.transcriber.postIteration(forge, pr.number, it);
                }
                await this.transcriber.postSummary(forge, pr.number, issue, iterations);

                await this.auditLog.append({
                    action: 'create_pr',
                    repo: `${forge.owner}/${forge.repo}`,
                    target: pr.url,
                    input: issue.bodyHash,
                    output: prBody,
                    decision: `PR #${pr.number} created`,
                    llmCallCount: iterations.length,
                    details: `${iterations.length} iterations, CI ${ciPassed ? 'passing' : 'not passing'}`,
                });

                this.addActivity(issue.repo, issue.issueNumber, pr.number, '📤', `Opened PR #${pr.number}`, pr.url);

                // ── Step 5b: Post acknowledgment on the issue ──
                await this.postIssueAcknowledgment(forge, issue, pr.number, pr.url, evaluation);

                // ── Step 6: Monitor comments on the issue ──
                await this.processNewIssueComments(forge, issue);

                // ── Step 7: Analyze competing PRs ──
                issue.state = 'analyzing-competing';
                const competing = await this.prAnalyzer.analyzeCompetingPRs(forge, issue);
                issue.competingPRs = competing;

                if (competing.length > 0) {
                    await this.transcriber.postCompetitiveAnalysis(forge, pr.number, competing);
                    this.addActivity(issue.repo, issue.issueNumber, pr.number, '⚔️', `Analyzed ${competing.length} competing PRs`);

                    // ── Step 7: Synthesize if warranted ──
                    const ourAnalysis = competing.find((a) => a.isOurInstance);
                    if (this.prAnalyzer.shouldSynthesize(ourAnalysis, competing.filter((c) => !c.isOurInstance))) {
                        issue.state = 'synthesizing';
                        const synthesisPlan = await this.prAnalyzer.planSynthesis(
                            competing.filter((c) => !c.isOurInstance),
                            ourAnalysis,
                        );
                        await this.transcriber.postSynthesisPlan(forge, pr.number, synthesisPlan);
                        this.addActivity(issue.repo, issue.issueNumber, pr.number, '🧬', 'Planned super PR synthesis');
                    }
                }
            }

            issue.state = 'done';
            issue.completedAt = new Date();
            this.addActivity(issue.repo, issue.issueNumber, issue.prNumber, '✔️', `Completed issue #${issue.issueNumber}`);

        } catch (err) {
            issue.state = 'stuck';
            issue.error = String(err);
            this.logger.error(`Pipeline failed for issue #${issue.issueNumber}: ${err}`);
            this.addActivity(issue.repo, issue.issueNumber, undefined, '💥', `Error: ${String(err).substring(0, 100)}`);
        } finally {
            this.sessions.delete(sessionKey);
        }

        return issue;
    }

    // ─── State Access ───────────────────────────────────────────────

    getWorkQueue(): readonly TrackedIssue[] {
        return this.workQueue;
    }

    getActivity(limit: number = 50): readonly ActivityEntry[] {
        return this.activity.slice(-limit);
    }

    getIssuesByState(state: IssueState): TrackedIssue[] {
        return this.workQueue.filter((i) => i.state === state);
    }

    // ─── Private Helpers ────────────────────────────────────────────

    private isAlreadyTracked(issue: Issue): boolean {
        return this.workQueue.some(
            (t) => t.issueNumber === issue.number && t.repo === issue.repo
        );
    }

    private addActivity(
        repo: RepoKey,
        issueNumber: number | undefined,
        prNumber: number | undefined,
        icon: string,
        message: string,
        url?: string,
    ): void {
        this.activity.push({
            timestamp: new Date(),
            repo,
            issueNumber,
            prNumber,
            icon,
            message,
            url,
        });

        // Keep activity log bounded
        if (this.activity.length > 500) {
            this.activity = this.activity.slice(-300);
        }
    }

    private async buildPRBody(
        issue: TrackedIssue,
        evaluation: any,
        iterations: any[],
    ): Promise<string> {
        const lastIteration = iterations[iterations.length - 1];

        const content = `## Automated Fix for #${issue.issueNumber}

${evaluation.reasoning}

### Approach
${evaluation.proposedApproach}

### Changes
${iterations.flatMap((it: any) => it.filesChanged.map((f: any) => `- \`${f.path}\``)).join('\n') || '_See iteration comments_'}

### CI Status
${lastIteration?.ciResult === 'passing' ? '✅ Passing' : '⚠️ Not passing — human review recommended'}

---

> 🤖 This PR was generated by **Argus** — an AI code issue agent.
> It should be reviewed by a human before merging.
> **Argus never merges PRs.**
>
> See the comments below for full AI reasoning transcription.`;

        const { stamped } = this.stampManager.stampContent(content);
        return stamped;
    }

    // ─── Issue Comment Management ───────────────────────────────────

    /**
     * Check if Argus has the "last word" on an issue.
     * Returns true if the most recent comment has an Argus stamp — meaning
     * nobody has replied since we last responded, so there's nothing new to do.
     * Returns false if:
     *  - There are no comments at all (new issue)
     *  - The most recent comment is NOT from Argus (someone replied — re-engage)
     *  - We can't read comments (fail open — process the issue)
     */
    private async argusHasLastWord(forge: Forge, issueNumber: number): Promise<boolean> {
        try {
            const comments = await forge.getIssueComments(issueNumber);
            if (comments.length === 0) { return false; }

            // Sort by creation date descending to find the most recent
            const sorted = [...comments].sort(
                (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
            );
            const latest = sorted[0];

            return this.stampManager.hasStamp(latest.body);
        } catch (err) {
            this.logger.debug(`Could not check last word for issue #${issueNumber}: ${err}`);
            return false; // Fail open — process the issue if we can't check
        }
    }

    /**
     * Post a stamped acknowledgment comment on the original issue linking to the PR.
     * This serves two purposes:
     *  1. Tells the issue author that Argus is working on it
     *  2. Marks the issue as processed (stamp prevents re-evaluation)
     */
    private async postIssueAcknowledgment(
        forge: Forge,
        issue: TrackedIssue,
        prNumber: number,
        prUrl: string,
        evaluation: any,
    ): Promise<void> {
        const content = `## 🤖 Argus — Issue Acknowledged

I've evaluated this issue and created a pull request with a proposed fix.

| | |
|---|---|
| **Pull Request** | #${prNumber} |
| **Category** | ${evaluation.category} |
| **Severity** | ${evaluation.severity} |
| **Confidence** | ${(evaluation.confidence * 100).toFixed(0)}% |

### Proposed Approach
${evaluation.proposedApproach}

> Please review the PR for the full AI reasoning transcript and code changes.
> Argus **never** merges PRs — a human must approve and merge.`;

        const { stamped } = this.stampManager.stampContent(content);
        await forge.addComment(issue.issueNumber, stamped);
        this.logger.info(`Posted acknowledgment on issue #${issue.issueNumber} linking to PR #${prNumber}`);
        this.addActivity(issue.repo, issue.issueNumber, prNumber, '💬', `Posted acknowledgment on issue #${issue.issueNumber}`);
    }

    /**
     * Check for new comments on an issue that Argus hasn't responded to.
     * Runs the comment handler for moderation, plus evaluates content comments
     * for relevance (e.g., additional context, corrections, requests).
     */
    private async processNewIssueComments(
        forge: Forge,
        issue: TrackedIssue,
    ): Promise<void> {
        try {
            const comments = await forge.getIssueComments(issue.issueNumber);

            // Find comments that are NOT from Argus (no stamp) and came after
            // the issue was first enqueued
            const ourCommentDates = new Set<string>();
            const newComments: typeof comments = [];

            for (const comment of comments) {
                if (this.stampManager.hasStamp(comment.body)) {
                    ourCommentDates.add(comment.id);
                    continue;
                }
                // Only look at comments posted after we started processing
                if (issue.startedAt && comment.createdAt > issue.startedAt) {
                    newComments.push(comment);
                }
            }

            if (newComments.length === 0) {
                this.logger.debug(`No new comments on issue #${issue.issueNumber}`);
                return;
            }

            this.logger.info(
                `Processing ${newComments.length} new comment(s) on issue #${issue.issueNumber}`,
            );

            // Run moderation/threat assessment on new comments
            const actions = await this.commentHandler.processComments(
                forge, issue, newComments,
            );

            // Log results
            for (const action of actions) {
                if (action.threatClassification !== 'clean') {
                    this.addActivity(
                        issue.repo, issue.issueNumber, issue.prNumber,
                        '🛡️', `Comment by @${action.author}: ${action.threatClassification}`,
                    );
                }
            }

            // For clean comments that might contain useful feedback,
            // post a stamped acknowledgment
            const cleanComments = newComments.filter((c) => {
                const action = actions.find((a) => a.commentId === c.id);
                return action && action.threatClassification === 'clean';
            });

            if (cleanComments.length > 0 && issue.prNumber) {
                const commentSummary = cleanComments
                    .map((c) => `- @${c.author}: ${c.body.substring(0, 200)}`)
                    .join('\n');

                const content = `## 💬 New Comments Noted

${cleanComments.length} new comment(s) received on issue #${issue.issueNumber} after PR creation:

${commentSummary}

> These comments have been logged. If they require code changes, please comment on this PR with specific instructions.`;

                const { stamped } = this.stampManager.stampContent(content);
                await forge.addPRComment(issue.prNumber, stamped);
                this.addActivity(
                    issue.repo, issue.issueNumber, issue.prNumber,
                    '💬', `Noted ${cleanComments.length} new comment(s) on issue`,
                );
            }
        } catch (err) {
            this.logger.error(`Failed processing comments for issue #${issue.issueNumber}: ${err}`);
        }
    }
}
