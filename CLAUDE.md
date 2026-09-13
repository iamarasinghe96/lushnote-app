# CLAUDE.md

**The rules for working on this project are in [`AGENTS.md`](AGENTS.md). Read it first.**

One rulebook, deliberately. This file used to hold its own copy, the two drifted,
and the copy ended up instructing an agent to create a Firestore TTL on a field
that would have deleted every system log within a day. `AGENTS.md` is the name
other agent tooling looks for, so it is the one that is kept current.

Reference material - how the app works and why - is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
