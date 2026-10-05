# Architecture Decisions

## ADR-001

Date: 2026-10-05

Decision: Treat `C:\Users\acer\OneDrive\Documents\Selected Works\AI` as the project root and bootstrap the collaboration control center before any feature work.

Reason: The folder was empty — no AGENTS.md, no `.ai/` registries, no git repo. The protocol requires these before coding.

Alternatives considered: Starting feature code immediately (rejected: would mean guessing architecture, forbidden by rule 21); waiting entirely with no setup (rejected: blocks both agents from coordinating).

Impact: Creates the baseline commit on `main`. No application code, no API contracts, no dependencies introduced.

Affected files: AGENTS.md, .gitignore, .ai/*, docs/*, tests/

## ADR-002

Date: 2026-10-05

Decision: Publish a PROVISIONAL ownership split in `.ai/ownership.json` mirroring the protocol's role descriptions, plus an explicit `shared` section.

Reason: Ownership registry is required before coding, but no `src/` tree exists yet to map. Provisional globs give both agents a starting contract; they change only by explicit coordination.

Alternatives considered: Leaving ownership.json absent (rejected: makes every future edit ambiguous); declaring full ownership myself (rejected: incompatible with shared-lead model).

Impact: Agent A should review/adjust globs when the real architecture lands; record any change here and in `.ai/communication/`.

Affected files: .ai/ownership.json
