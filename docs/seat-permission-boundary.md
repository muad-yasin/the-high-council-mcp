# Seat permission boundary

A design for a THCMCP front end (Sophi-A's C&C screen) puts one line under every side seat's
controls: *"Reaches {seat}'s own agents only. It cannot message another seat or another session -
only your home seat dispatches."* This note records what makes that true for planning seats, and
where it is not THCMCP's to enforce. From MLLM Coder v5 item 8
(`relay/runs/2026-09-15T03-43-44-216Z/deliverable.md`).

## Planning seats: true by construction

- **A seat exists only inside one chain run.** A seat is `{ provider, model, maxTokens?, temperature?,
  extra?, lab?, region?, role? }` in a chain config. There is no seat that outlives a run, and no
  "agents belonging to a seat" in the data model.
- **Seats never message each other.** Every call a run makes happens inside one CLI process, in the
  order `runChain()` sets. The only thing one seat ever sees of another is what the chain itself puts
  in a prompt (for example the anonymised proposals in the debate stage).
- **Nothing routes between sessions.** No MCP tool takes a seat or agent identity, and a stage answer
  can only be written to the run and stage that run is waiting for: `submit_stage` refuses any other
  stage label.

So there is nothing to enforce here. `test/mcp-seat-boundary.test.js` pins the two checkable parts
against a live MCP server: no tool's input schema names a seat or agent, and `submit_stage` rejects a
stage the run did not pause for.

## Build seats: not THCMCP's boundary

Build seats supervise swarms of coding agents. Enforcing that a build seat reaches only its own agents
belongs to the coding-agent plan (Project A), which owns worker agents, their cards and their
boundary. It is not duplicated here.

## Reopen trigger

If Project A introduces persistent agents that call THCMCP's MCP tools, THCMCP has to decide whether
those tools accept a seat or agent identity. At that point this stops being true by construction and
needs a real check.
