// Copyright 2026 Colin Byron. Apache-2.0 license.

export type {
    Forge,
    ForgePlatform,
    Issue,
    Comment,
    PullRequest,
    FileChange,
    CheckRun,
    CommitStatus,
    CodeSearchResult,
    RepoConfig,
    RepoKey,
    RepoRole,
    UserHistory,
} from './types';
export { repoKey } from './types';
export { GitHubForge } from './github';
export { GitLabForge } from './gitlab';
export { createForge } from './factory';
