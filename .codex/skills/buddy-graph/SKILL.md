---
name: buddy-graph
description: Generate and open an interactive visualization of Buddy guard-mode reasoning data using Buddy's local CLI command. Use when the user wants to inspect claims, edges, findings, sessions, or reasoning structure as a graph, including session-specific graph views for debugging or analysis. This skill should invoke the Buddy CLI rather than any MCP tool.
---

# Buddy Graph

Use Buddy's CLI graph command to generate a local HTML visualization of the reasoning graph.

## Quick Start

Run one of these commands from the Buddy repo:

```bash
buddy graph
buddy graph <session_id>
buddy graph --open
buddy graph <session_id> --out ./my-graph.html
```

If the packaged `buddy` binary is not available yet, run the built CLI directly:

```bash
node dist/cli/buddy.js graph
node dist/cli/buddy.js graph <session_id>
```

## Expected Output

The command writes an HTML file and prints the saved path plus graph counts.

## Notes

- This skill is intentionally CLI-backed, not MCP-backed.
- It reads Buddy reasoning data from `~/.buddy/buddy.db` unless `BUDDY_DB_PATH` is set.
- Use a `session_id` to isolate one workspace/day graph.
