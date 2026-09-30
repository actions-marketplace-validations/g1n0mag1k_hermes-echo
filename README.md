# Hermes Echo

[![npm version](https://img.shields.io/npm/v/@hermes-tools/hermes-echo.svg)](https://www.npmjs.com/package/@hermes-tools/hermes-echo)
[![GitHub release](https://img.shields.io/github/v/release/g1n0mag1k/hermes-echo)](https://github.com/g1n0mag1k/hermes-echo/releases)

Discover what your CLI actually does. Catch behavioral changes your tests missed.

## What it does

Hermes Echo finds your CLI’s console scripts from `setup.py` / `pyproject.toml`, including nested subcommands, and runs them like a user would. You accept the observed exit code, stdout, and stderr as Echo Contracts and commit them. On every pull request it re-runs those probes and comments when behavior drifts — it caught a version string change on [hermes-relay PR #10](https://github.com/g1n0mag1k/hermes-relay/pull/10) that tests missed.

## Quick start (GitHub Actions)

Add this to `.github/workflows/hermes-echo.yml`:

```yaml
name: Hermes Echo
on:
  pull_request:

jobs:
  echo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - uses: g1n0mag1k/hermes-echo@v0.3.1
        with:
          command: myapp
```

Replace `myapp` with your console script name. Accept contracts locally, commit `.hermes/contracts/`, and PR comments will show contract drift.

## What you'll see in your PR

Real comment from [hermes-relay PR #10](https://github.com/g1n0mag1k/hermes-relay/pull/10):

> ## 🔬 Hermes Echo · ECHO DETECTED A CHANGE
> **7 probes executed** · **6 unchanged** · **1 possible changes** · **0 skipped**
>
> ## Echo Contracts
> 4 of 5 accepted contracts verified
>
> | Probe | Contract | Status |
> |-------|----------|--------|
> | export-receipts | exit 2, stderr present | ✓ HOLDS |
> | help | exit 0, stderr empty | ✓ HOLDS |
> | keystore-init | exit 2, stderr present | ✓ HOLDS |
> | keystore-public-key | exit 2, stderr present | ✓ HOLDS |
> | version | exit 0, stderr empty | ✗ DRIFTED |
> | | Stdout drifted: 1 line(s) changed | |
>
> **Stdout diff** (`version`):
> ```diff
> -Hermes Relay v1.0.0
> +Hermes Relay v1.0.1
> ```

## Local CLI usage

```bash
npm install -g @hermes-tools/hermes-echo
hermes-echo doctor --command myapp
hermes-echo accept
hermes-echo accept validate
```

## How contracts work

- Accepted probes are stored as `.hermes/contracts/*.yml` (names like `env-show`, `fmt-check`)
- Each contract locks exit code, full stdout, and full stderr
- On PRs, Hermes Echo verifies those contracts and posts a drift table plus a git-style stdout/stderr diff

## Compliance

Accepted Echo Contracts are version-controlled records of observed CLI behavior — what exited, what printed, and when you accepted it. That gives regulated teams durable audit evidence aligned with 21 CFR Part 11 and GAMP 5 expectations for documented, reviewable system behavior.

Built by [Hermes Relay](https://hermesrelay.dev)
