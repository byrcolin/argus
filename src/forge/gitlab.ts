// Copyright 2026 Colin Byron. Apache-2.0 license.

/**
 * GitLab forge implementation — placeholder structure.
 * Uses GitLab REST API v4.
 *
 * NOTE: This is a structural scaffold. Full implementation requires
 * @gitbeaker/rest or direct fetch calls to GitLab API.
 */

import type {
    Forge,
    ForgePlatform,
    Issue,
    Comment,
    PullRequest,
    FileChange,
    CheckRun,
    CommitStatus,
    CodeSearchResult,
    RepoRole,
    UserHistory,
    RepoKey,
} from './types';
import { repoKey } from './types';

export class GitLabForge implements Forge {
    readonly platform: ForgePlatform = 'gitlab';
    private readonly baseUrl: string;
    private readonly projectPath: string;
    private defaultBranchCache: string | null = null;

    constructor(
        readonly owner: string,
        readonly repo: string,
        private readonly token: string,
        baseUrl: string = 'https://gitlab.com',
    ) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.projectPath = encodeURIComponent(`${owner}/${repo}`);
    }

    get key(): RepoKey {
        return repoKey({ forge: 'gitlab', owner: this.owner, repo: this.repo, pollIntervalMinutes: 0 });
    }

    private async api<T>(path: string, options: RequestInit = {}): Promise<T> {
        const url = `${this.baseUrl}/api/v4${path}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                'PRIVATE-TOKEN': this.token,
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });

        if (!response.ok) {
            throw new Error(`GitLab API error: ${response.status} ${response.statusText} for ${path}`);
        }

        return response.json() as Promise<T>;
    }

    // ─── Issues ─────────────────────────────────────────────────────

    async listNewIssues(since: Date): Promise<Issue[]> {
        const params = new URLSearchParams({
            state: 'opened',
            created_after: since.toISOString(),
            order_by: 'created_at',
            sort: 'asc',
            per_page: '100',
        });
        const data = await this.api<any[]>(`/projects/${this.projectPath}/issues?${params}`);
        return data.map((i) => this.mapIssue(i));
    }

    async getIssue(issueNumber: number): Promise<Issue> {
        const data = await this.api<any>(`/projects/${this.projectPath}/issues/${issueNumber}`);
        return this.mapIssue(data);
    }

    async getIssueComments(issueNumber: number): Promise<Comment[]> {
        const data = await this.api<any[]>(`/projects/${this.projectPath}/issues/${issueNumber}/notes?per_page=100`);
        return data.filter((n) => !n.system).map((n) => this.mapComment(n, issueNumber));
    }

    async getCommentsSince(issueNumber: number, since: Date): Promise<Comment[]> {
        const comments = await this.getIssueComments(issueNumber);
        return comments.filter((c) => c.createdAt >= since);
    }

    async addLabel(issueNumber: number, label: string): Promise<void> {
        const issue = await this.api<any>(`/projects/${this.projectPath}/issues/${issueNumber}`);
        const labels = [...(issue.labels || []), label];
        await this.api(`/projects/${this.projectPath}/issues/${issueNumber}`, {
            method: 'PUT',
            body: JSON.stringify({ labels: labels.join(',') }),
        });
    }

    async removeLabel(issueNumber: number, label: string): Promise<void> {
        const issue = await this.api<any>(`/projects/${this.projectPath}/issues/${issueNumber}`);
        const labels = (issue.labels || []).filter((l: string) => l !== label);
        await this.api(`/projects/${this.projectPath}/issues/${issueNumber}`, {
            method: 'PUT',
            body: JSON.stringify({ labels: labels.join(',') }),
        });
    }

    async addComment(issueNumber: number, body: string): Promise<Comment> {
        const data = await this.api<any>(`/projects/${this.projectPath}/issues/${issueNumber}/notes`, {
            method: 'POST',
            body: JSON.stringify({ body }),
        });
        return this.mapComment(data, issueNumber);
    }

    // ─── Pull Requests (Merge Requests in GitLab) ───────────────────

    async listPRsForIssue(issueNumber: number): Promise<PullRequest[]> {
        // Search for MRs that mention the issue
        const data = await this.api<any[]>(
            `/projects/${this.projectPath}/merge_requests?state=opened&per_page=100`
        );
        const issueRef = `#${issueNumber}`;
        return data
            .filter((mr) => (mr.description || '').includes(issueRef) || (mr.title || '').includes(issueRef))
            .map((mr) => this.mapMR(mr));
    }

    async getPullRequest(prNumber: number): Promise<PullRequest> {
        const data = await this.api<any>(`/projects/${this.projectPath}/merge_requests/${prNumber}`);
        return this.mapMR(data);
    }

    async getPRComments(prNumber: number): Promise<Comment[]> {
        const data = await this.api<any[]>(
            `/projects/${this.projectPath}/merge_requests/${prNumber}/notes?per_page=100`
        );
        return data.filter((n) => !n.system).map((n) => this.mapComment(n, prNumber));
    }

    async getPRFiles(prNumber: number): Promise<FileChange[]> {
        const data = await this.api<any[]>(
            `/projects/${this.projectPath}/merge_requests/${prNumber}/changes`
        );
        // GitLab returns changes in the MR diff
        const changes: any[] = (data as any).changes || [];
        return changes.map((c) => ({
            path: c.new_path || c.old_path,
            status: c.new_file ? 'added' as const : c.deleted_file ? 'removed' as const : c.renamed_file ? 'renamed' as const : 'modified' as const,
            additions: 0, // GitLab doesn't provide line counts directly
            deletions: 0,
            patch: c.diff,
        }));
    }

    async createPullRequest(head: string, base: string, title: string, body: string): Promise<PullRequest> {
        const data = await this.api<any>(`/projects/${this.projectPath}/merge_requests`, {
            method: 'POST',
            body: JSON.stringify({
                source_branch: head,
                target_branch: base,
                title,
                description: body,
            }),
        });
        return this.mapMR(data);
    }

    async addPRComment(prNumber: number, body: string): Promise<Comment> {
        const data = await this.api<any>(
            `/projects/${this.projectPath}/merge_requests/${prNumber}/notes`,
            { method: 'POST', body: JSON.stringify({ body }) },
        );
        return this.mapComment(data, prNumber);
    }

    async updatePRBody(prNumber: number, body: string): Promise<void> {
        await this.api(`/projects/${this.projectPath}/merge_requests/${prNumber}`, {
            method: 'PUT',
            body: JSON.stringify({ description: body }),
        });
    }

    // ─── Branches & Files ───────────────────────────────────────────

    async getDefaultBranch(): Promise<string> {
        if (this.defaultBranchCache) { return this.defaultBranchCache; }
        const data = await this.api<any>(`/projects/${this.projectPath}`);
        this.defaultBranchCache = data.default_branch;
        return data.default_branch;
    }

    async createBranch(baseBranch: string, newBranch: string): Promise<void> {
        await this.api(`/projects/${this.projectPath}/repository/branches`, {
            method: 'POST',
            body: JSON.stringify({ branch: newBranch, ref: baseBranch }),
        });
    }

    async getFileContent(branch: string, path: string): Promise<string> {
        const encodedPath = encodeURIComponent(path);
        const data = await this.api<any>(
            `/projects/${this.projectPath}/repository/files/${encodedPath}?ref=${branch}`
        );
        return Buffer.from(data.content, 'base64').toString('utf-8');
    }

    async createOrUpdateFile(branch: string, path: string, content: string, message: string): Promise<void> {
        const encodedPath = encodeURIComponent(path);
        const payload = {
            branch,
            content,
            commit_message: message,
        };

        try {
            // Try update first
            await this.api(`/projects/${this.projectPath}/repository/files/${encodedPath}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
        } catch {
            // File doesn't exist — create
            await this.api(`/projects/${this.projectPath}/repository/files/${encodedPath}`, {
                method: 'POST',
                body: JSON.stringify(payload),
            });
        }
    }

    // ─── CI ─────────────────────────────────────────────────────────

    async getCommitStatuses(ref: string): Promise<CommitStatus[]> {
        const data = await this.api<any[]>(
            `/projects/${this.projectPath}/repository/commits/${ref}/statuses`
        );
        return data.map((s) => ({
            state: s.status as CommitStatus['state'],
            context: s.name,
            description: s.description || '',
            url: s.target_url || '',
        }));
    }

    async getCheckRuns(ref: string): Promise<CheckRun[]> {
        // GitLab uses pipelines, not check runs
        const data = await this.api<any[]>(
            `/projects/${this.projectPath}/pipelines?sha=${ref}&per_page=5`
        );
        return data.map((p) => ({
            id: p.id.toString(),
            name: `Pipeline #${p.id}`,
            status: p.status === 'running' ? 'in_progress' as const : p.status === 'pending' ? 'queued' as const : 'completed' as const,
            conclusion: p.status === 'success' ? 'success' as const : p.status === 'failed' ? 'failure' as const : null,
            url: p.web_url || '',
            startedAt: p.started_at ? new Date(p.started_at) : undefined,
            completedAt: p.finished_at ? new Date(p.finished_at) : undefined,
        }));
    }

    async getCheckRunLog(checkRunId: string): Promise<string> {
        try {
            const jobs = await this.api<any[]>(
                `/projects/${this.projectPath}/pipelines/${checkRunId}/jobs`
            );
            const failedJobs = jobs.filter((j) => j.status === 'failed');
            const logs: string[] = [];
            for (const job of failedJobs.slice(0, 3)) {
                try {
                    const log = await this.api<string>(
                        `/projects/${this.projectPath}/jobs/${job.id}/trace`
                    );
                    logs.push(`=== ${job.name} ===\n${log}`);
                } catch { /* */ }
            }
            return logs.join('\n\n') || 'No failure logs available';
        } catch {
            return 'Unable to retrieve pipeline log';
        }
    }

    // ─── Code Search ────────────────────────────────────────────────

    async searchCode(query: string): Promise<CodeSearchResult[]> {
        const data = await this.api<any[]>(
            `/projects/${this.projectPath}/search?scope=blobs&search=${encodeURIComponent(query)}&per_page=20`
        );
        return data.map((item) => ({
            path: item.filename,
            matchedLines: [{ lineNumber: item.startline || 0, text: item.data || '' }],
            url: `${this.baseUrl}/${this.owner}/${this.repo}/-/blob/${item.ref}/${item.filename}`,
        }));
    }

    // ─── Users ──────────────────────────────────────────────────────

    async getUserRole(username: string): Promise<RepoRole> {
        try {
            const members = await this.api<any[]>(`/projects/${this.projectPath}/members/all`);
            const member = members.find((m) => m.username === username);
            if (!member) { return 'none'; }
            const accessMap: Record<number, RepoRole> = {
                50: 'owner',
                40: 'maintainer',
                30: 'write',
                20: 'triage',
                10: 'read',
            };
            return accessMap[member.access_level] || 'none';
        } catch {
            return 'none';
        }
    }

    async getUserHistory(username: string): Promise<UserHistory> {
        // Simplified — GitLab search is more limited
        return {
            mergedPRs: 0,
            closedIssuesAsValid: 0,
            previousFlags: 0,
            previousBlocks: 0,
            totalComments: 0,
        };
    }

    // ─── Moderation ─────────────────────────────────────────────────

    async deleteComment(commentId: string): Promise<void> {
        // GitLab notes require knowing the noteable type and ID
        // This is a simplified version
        console.warn(`GitLab deleteComment(${commentId}) — requires noteable context`);
    }

    async blockUser(username: string): Promise<void> {
        try {
            const users = await this.api<any[]>(`/users?username=${username}`);
            if (users.length > 0) {
                await this.api(`/users/${users[0].id}/block`, { method: 'POST' });
            }
        } catch {
            console.warn(`Unable to block GitLab user ${username}`);
        }
    }

    async unblockUser(username: string): Promise<void> {
        try {
            const users = await this.api<any[]>(`/users?username=${username}`);
            if (users.length > 0) {
                await this.api(`/users/${users[0].id}/unblock`, { method: 'POST' });
            }
        } catch { /* */ }
    }

    async reportUser(username: string, reason: string): Promise<void> {
        console.warn(`Report user ${username}: ${reason} — GitLab has no public report API`);
    }

    // ─── Token Validation ───────────────────────────────────────────

    async validateTokenScopes(): Promise<{ valid: boolean; warnings: string[]; errors: string[] }> {
        try {
            const data = await this.api<any>('/personal_access_tokens/self');
            const scopes: string[] = data.scopes || [];

            const warnings: string[] = [];
            const errors: string[] = [];

            const dangerous = ['sudo', 'admin_mode'];
            for (const scope of dangerous) {
                if (scopes.includes(scope)) {
                    errors.push(`Token has '${scope}' scope which Argus should not have.`);
                }
            }

            if (!scopes.includes('api') && !scopes.includes('read_api')) {
                warnings.push('Token may need "api" or "read_api" scope.');
            }

            return { valid: errors.length === 0, warnings, errors };
        } catch {
            return { valid: true, warnings: ['Could not verify token scopes'], errors: [] };
        }
    }

    // ─── Private Mappers ────────────────────────────────────────────

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private mapIssue(data: any): Issue {
        return {
            id: data.id.toString(),
            number: data.iid,
            title: data.title,
            body: data.description || '',
            author: data.author?.username || 'unknown',
            authorAssociation: 'NONE',
            state: data.state === 'opened' ? 'open' : 'closed',
            labels: data.labels || [],
            url: data.web_url,
            apiUrl: `${this.baseUrl}/api/v4/projects/${this.projectPath}/issues/${data.iid}`,
            createdAt: new Date(data.created_at),
            updatedAt: new Date(data.updated_at),
            repo: this.key,
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private mapComment(data: any, issueNumber: number): Comment {
        return {
            id: data.id.toString(),
            body: data.body || '',
            author: data.author?.username || 'unknown',
            authorAssociation: 'NONE',
            url: '',
            createdAt: new Date(data.created_at),
            updatedAt: new Date(data.updated_at),
            issueNumber,
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private mapMR(data: any): PullRequest {
        let state: PullRequest['state'] = 'open';
        if (data.state === 'merged') { state = 'merged'; }
        else if (data.state === 'closed') { state = 'closed'; }

        return {
            id: data.id.toString(),
            number: data.iid,
            title: data.title,
            body: data.description || '',
            author: data.author?.username || 'unknown',
            authorAssociation: 'NONE',
            state,
            head: data.source_branch || '',
            base: data.target_branch || '',
            url: data.web_url,
            apiUrl: `${this.baseUrl}/api/v4/projects/${this.projectPath}/merge_requests/${data.iid}`,
            labels: data.labels || [],
            createdAt: new Date(data.created_at),
            updatedAt: new Date(data.updated_at),
            repo: this.key,
        };
    }
}
