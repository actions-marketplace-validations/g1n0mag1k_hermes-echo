# Hermes Echo

[![npm version](https://img.shields.io/npm/v/hermes-echo.svg)](https://www.npmjs.com/package/hermes-echo)
[![GitHub release](https://img.shields.io/github/v/release/g1n0mag1k/hermes-echo)](https://github.com/g1n0mag1k/hermes-echo/releases)

Your tests passed. The echo changed. Hermes Echo runs your CLI like a user would, compares behavior on pull requests, and flags drift against accepted **Echo Contracts**.

## Quick start (GitHub Actions)

Add this to `.github/workflows/hermes-echo.yml` — no extra config required beyond your CLI’s `setup.py` / `pyproject.toml` install:

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
      - uses: g1n0mag1k/hermes-echo@v0.2.0
        with:
          command: myapp
```

Replace `myapp` with your console script name. Accept contracts locally with `hermes-echo accept`, commit `.hermes/contracts/`, and PR comments will show contract drift.

## CLI

```bash
npm install -g hermes-echo
hermes-echo doctor --command myapp
hermes-echo accept
```

See [CONTRACTS.md](./CONTRACTS.md) for how Echo Contracts work.

by [Hermes Relay](https://hermesrelay.dev)
