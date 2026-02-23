// Copyright 2026 Colin Byron. Apache-2.0 license.

/**
 * Forge factory — creates the appropriate forge implementation based on config.
 */

import * as vscode from 'vscode';
import type { Forge, RepoConfig } from './types';
import { GitHubForge } from './github';
import { GitLabForge } from './gitlab';

const GITHUB_TOKEN_KEY = 'argus.githubToken';
const GITLAB_TOKEN_KEY = 'argus.gitlabToken';

/**
 * Create a Forge instance for the given repo configuration.
 * Retrieves tokens from VS Code SecretStorage.
 */
export async function createForge(
    config: RepoConfig,
    secrets: vscode.SecretStorage,
): Promise<Forge> {
    switch (config.forge) {
        case 'github': {
            const token = await secrets.get(GITHUB_TOKEN_KEY);
            if (!token) {
                const entered = await vscode.window.showInputBox({
                    prompt: 'Enter your GitHub Personal Access Token for Argus',
                    password: true,
                    placeHolder: 'ghp_...',
                });
                if (!entered) {
                    throw new Error('GitHub token is required. Configure via Argus settings.');
                }
                await secrets.store(GITHUB_TOKEN_KEY, entered);
                return new GitHubForge(config.owner, config.repo, entered);
            }
            return new GitHubForge(config.owner, config.repo, token);
        }

        case 'gitlab': {
            const token = await secrets.get(GITLAB_TOKEN_KEY);
            if (!token) {
                const entered = await vscode.window.showInputBox({
                    prompt: 'Enter your GitLab Personal Access Token for Argus',
                    password: true,
                    placeHolder: 'glpat-...',
                });
                if (!entered) {
                    throw new Error('GitLab token is required. Configure via Argus settings.');
                }
                await secrets.store(GITLAB_TOKEN_KEY, entered);
                return new GitLabForge(config.owner, config.repo, entered);
            }
            return new GitLabForge(config.owner, config.repo, token);
        }

        default:
            throw new Error(`Unsupported forge platform: ${config.forge}`);
    }
}
