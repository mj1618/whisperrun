# WhisperRun — AGENTS.md

## Swarm Pipeline

This project uses a 3-agent swarm pipeline defined in `swarm/swarm.yaml`:

### Planner
- Reads the project plan and completed tasks
- Decides what to build next (follows milestone order from `swarm/PLAN.md`)
- Writes `.todo.md` files in `swarm/todos/`
- Only creates a task if no pending tasks exist

### Developer
- Picks up `.todo.md` files, renames to `.processing.md`
- Implements the feature as described
- Tests the implementation (npm run dev, browser testing, Convex dashboard)
- Moves completed task to `swarm/done/` as `.done.md`

### Reviewer
- Picks up `.done.md` files, renames to `.reviewing.md`
- Reviews code for bugs, type safety, performance, security
- Fixes issues directly in the code
- Renames to `.reviewed.md` when complete

## Task File Lifecycle

```
swarm/todos/*.todo.md          — Pending task (Planner creates)
swarm/todos/*.processing.md    — In progress (Developer working)
swarm/done/*.done.md           — Completed (Developer finished)
swarm/done/*.reviewing.md      — Under review (Reviewer working)
swarm/done/*.reviewed.md       — Reviewed and approved
```

## Important Notes

- One task at a time — Planner won't create new tasks if any `.todo.md` or `.processing.md` exist
- Tasks follow milestone order from `swarm/PLAN.md`
- Each task should be feature-sized (one coherent unit of work)
- Developers should run `npm run dev` and `npx convex dev` to verify their work
