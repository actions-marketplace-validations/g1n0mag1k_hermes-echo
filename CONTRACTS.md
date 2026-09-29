# Echo Contracts

An Echo Contract is an accepted behavioral statement: the moment you decide that a live observation is correct and you want the project to keep honoring it. Contracts turn one-time probe runs into durable commitments that Hermes Echo can check on every pull request.

## Accepting a Contract

Accept every discovered probe (confidence ≥ 70):

```bash
hermes-echo accept
```

Accept a single probe by name (case-insensitive, usually the CLI subcommand):

```bash
hermes-echo accept validate
```

## What Gets Stored

Each accepted probe is written to `.hermes/contracts/<probe-name>.yml`:

```yaml
# Echo Contract — accepted 2025-01-15T10:30:00Z
probe: validate
command: testcli validate fixtures/valid.yml
accepted_at: 2025-01-15T10:30:00Z
accepted_by: hermes-echo v0.1.0
observations:
  exit_code: 0
  stdout_pattern: Configuration valid
  stderr_empty: true
notes: ''
```

`stdout_pattern` is a human-readable hint (first 60 characters of stdout, or `null` when empty). It is not used for automated matching in v0.1.

## Contracts in CI

When Hermes Echo runs on a pull request, it compares fresh probe observations against the contracts committed in the repository. The PR comment includes an **Echo Contracts** section reporting how many accepted contracts still hold and which probes have drifted relative to the accepted baseline.

## Why Contracts Belong in Version Control

- **Shared baseline** — everyone on the team agrees on the same accepted behavior.
- **History of accepted behavior** — contract files record when behavior was accepted and what was observed.
- **Compliance evidence** — accepted contracts support audit trails aligned with 21 CFR Part 11 and GAMP 5 expectations for documented, reviewable system behavior.

## v0.1 Scope

In v0.1, contract verification checks **exit code** and **whether stderr is empty**. `stdout_pattern` is stored for reviewers but not enforced automatically. Upcoming releases will add stdout pattern checks, full Echo Receipts linked to contracts, and long-term archive and signing of accepted evidence.
