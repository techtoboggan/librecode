# ADR-003: Agent Loop Formalization

**Status:** Accepted
**Date:** 2026-04-09
**Decision:** Document the implicit agent loop as an explicit state machine; extract state definitions and transition logic.

---

## Context

The agent loop in `session/prompt.ts` is an implicit state machine implemented as a `while(true)` loop with conditional branches. The control flow is distributed across three modules:

- `prompt.ts::loop()` — main orchestrator (457 lines)
- `processor.ts::process()` — LLM streaming + tool execution (376 lines)
- `compaction.ts::process()` — context management (329 lines)

The loop has 6 implicit states:

```
┌──────────────────┐
│ 1. INITIALIZE    │ Fetch messages, find lastUser/lastAssistant, load model
└────────┬─────────┘
         │
         ├──► [2. SUBTASK]     Execute delegated task via TaskTool
         ├──► [3. COMPACTION]  Compress history when context is full
         └──► [4. PROCESS]     Call LLM with tools
                    │
                    └──► [5. PROCESSOR] Stream response, execute tools, handle errors
                              │
                              └──► Returns "continue" | "compact" | "stop"
         │
         └──► [6. EXIT]       Prune, stream final message, return
```

## Problem

1. **Hard to follow**: The 457-line loop function mixes routing logic, state management, and error handling
2. **Hard to test**: Individual states can't be tested in isolation
3. **Hard to extend**: Adding new states (e.g., planning mode, review mode) requires modifying the monolithic loop
4. **Doom loop detection is ad-hoc**: Buried inside processor event handlers rather than being a first-class concept

## Decision

Formalize the loop as a documented state machine with:

1. **Explicit state enum** defining all possible states
2. **State handler functions** that process the current state and return the next state
3. **Transition table** documenting valid state transitions
4. **State context** carrying shared data between states

## State Machine Definition

```typescript
type AgentState =
  | { type: "initialize" }
  | { type: "route"; messages: MessageV2.WithParts[] }
  | { type: "subtask"; task: SubtaskPart }
  | { type: "compaction"; task: CompactionPart }
  | { type: "process"; messages: MessageV2.WithParts[]; step: number }
  | { type: "exit"; reason: ExitReason }

type ExitReason =
  | "complete"           // Model finished naturally
  | "abort"              // User cancelled
  | "error"              // Unrecoverable error
  | "structured_output"  // JSON schema result captured
  | "compaction_failed"  // Context still too large after compaction
  | "blocked"            // Permission denied

type Transition = (state: AgentState, ctx: AgentContext) => Promise<AgentState>
```

## Transition Table

| From | To | Condition |
|------|----|-----------|
| initialize | route | Messages loaded, model validated |
| initialize | exit | Abort signal, no lastUser |
| route | subtask | Pending subtask task found |
| route | compaction | Pending compaction task found |
| route | process | No pending tasks |
| route | exit | Last assistant finished (not tool-calls) and came before lastUser |
| subtask | initialize | Task executed, continue loop |
| compaction | initialize | Compaction succeeded |
| compaction | exit | Compaction returned "stop" |
| process | initialize | Processor returned "continue" or "compact" |
| process | exit | Processor returned "stop", structured output captured, or format error |

## Implementation Approach

Rather than rewriting the entire loop (high risk, many edge cases), we:

1. **Create `session/agent-loop.ts`** with the state machine types and transition documentation
2. **Keep the existing `loop()` function** as the implementation
3. **Add state tracking** via a `currentState` variable that's updated at each branch point
4. **Emit state transition events** for observability and debugging

This gives us the formalization without the rewrite risk.

## Consequences

### Positive
- Clear documentation of all states and transitions
- State events enable debugging ("why did the agent stop?")
- Foundation for future extensions (planning mode, review mode)
- Testable state transitions

### Negative
- The actual loop code still lives in prompt.ts (full extraction deferred)
- Two representations (code + state machine) must stay in sync
