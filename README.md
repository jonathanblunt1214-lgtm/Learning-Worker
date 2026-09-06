# Learning Worker

Private scheduling control for The Crucible's deterministic claim-extraction worker.

This repository contains no committed plaintext training documents, extracted source content, transport keys, credentials, or durable learning state. Every ten minutes its ephemeral GitHub-hosted worker pulls only oversight-approved ciphertext from the separate private vetted-custody store. Crucible cannot publish to that store. The worker verifies the independent oversight signature and exact ciphertext hash before temporary decryption, then destroys runner plaintext and persists only authenticated encrypted state.

## Fixed operating boundary

- Project identity: `github:jonathanblunt1214-lgtm/The-Crucible`
- Hosted custody: private release assets encrypted before upload; plaintext exists only in the ephemeral job workspace and is discarded with the runner
- Maximum sources per run: 25
- Maximum active documents per run: 9
- PDF pages per document: adaptive 70-page normal mode, 35-page fallback mode
- Candidate-count cutoff inside a bounded source window: none
- Learning classification after extraction: `Insufficient Evidence`
- Promotion, repository assimilation, and writes to The Crucible: prohibited
- Extraction requires a signed independent-oversight approval bound to the exact source content hash; unvetted sources remain inhibited.

The workflow has a concurrency lock and a 20-minute job timeout. Adaptive throughput state is retained only inside the authenticated encrypted state asset. A prior timed-out workflow immediately selects 35 pages; two consecutive completed runs longer than 15 minutes also select 35. Three consecutive runs of 10 minutes or less restore 70 pages. Its token can update only this private worker repository's encrypted release-state asset. It cannot write to The Crucible.

Each run treats the newly verified vetted-custody queue and learning envelope as authoritative. Prior encrypted worker state is decrypted into a separate directory; only extraction progress for the same source id and exact content hash, plus candidate-only records with identical duplicate bodies, may be merged forward. Legacy candidate records without `recordRevision` are treated as revision zero, matching The Crucible's durable-store compatibility rule. Removed sources and changed content remain excluded. Advanced learning records and knowledge versions are preserved verbatim in an additive encrypted quarantine artifact and cannot enter the active worker store; candidate-only records preserved by an earlier quarantine are safely recovered on the next run.

Every run also prepares a separately encrypted, candidate-only snapshot for independent oversight. That snapshot contains only the source queue and active candidate envelope, is bound to the exact worker and upstream vetted-state commits, and is published on the `oversight-export` branch only when its plaintext digest changes. It excludes source bodies, advanced learning records, knowledge versions, active versions, and quarantine payloads. The worker cannot publish this material to the vetted-state repository; oversight must independently authenticate, validate, merge, re-encrypt, sign, and publish it.

The hosted job reports the vetted-state commit and oversight report timestamp. If actionable extraction backlog exists but the worker processes zero sources, or if every processed source is blocked, the encrypted diagnostic state is still uploaded and the original extraction condition then fails the job. Artifact persistence is additive and cannot replace the pipeline failure.
