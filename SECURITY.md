# Security

## What this Action does

- Installs your project into the GitHub-hosted runner
- Executes your CLI commands locally on the runner
- Creates a Git worktree for the base revision
- Posts one comment to your PR via GITHUB_TOKEN

## What this Action does NOT do

- No telemetry. Nothing leaves the runner except the PR comment.
- No network requests to Hermes services
- No source code is uploaded anywhere
- No secrets are accessed beyond GITHUB_TOKEN

## Permissions required

- `contents: read` — to checkout and install the repo
- `pull-requests: write` — to post the PR comment

## Installation behavior

Hermes Echo installs your project using `pip install -e` on the GitHub-hosted runner. This executes your project's build/packaging code locally. No code is sent externally.

## Reporting a vulnerability

Open a GitHub issue or email andrew@hermesrelay.dev
