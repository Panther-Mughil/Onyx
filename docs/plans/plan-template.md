# [Feature Name]
*(File Name Convention: REQ-###-[ModelName].md)*

> **Planner Instruction:** 
> When the Planner uses this template to generate a specific plan, the Planner must dynamically decide which sections are necessary for the specific feature. Omit any sections that are completely irrelevant to maintain strict token efficiency.

## 1. Exact Feature Request and Clarified Requirements
[What the user actually wants, written unambiguously. Every ambiguity resolved.]

## 2. Explicit Scope — What the Agent is Allowed to Change
- **Allowed Files/Directories:** [List of files]
- **Involved Components/Modules:** [List]
- **In-Scope Functionality:** [What is allowed]
- **Out of Scope:** [Explicitly out of scope]

## 3. Current Architecture / Context
*(Agent Instruction: Refer to Graphify output or LSP context to fetch relevant files if needed)*
- **Relevant Files:** ...
- **Existing Components/Functions/Classes:** ...
- **Data Flow:** ...
- **APIs/Interfaces:** ...
- **Dependencies & Conventions:** ...

## 4. Exact Implementation Requirements
[Objective targets of what must exist after implementation]
- [Example: New endpoint must exist at POST /api/...]
- [Example: It must accept X, Validate Y, Store Z]

## 5. Step-by-Step Implementation Plan
[Concrete steps in dependency order]
1. [Modify X to expose Y]
2. [Add validation schema Z]

## 6. Acceptance Criteria / Definition of Done
*(Agent Instruction: As you complete these, report them one by one in the chat. Do NOT modify this file)*
- [ ] POST /api/users accepts the required payload
- [ ] Invalid email returns 400

## 7. Constraints and Invariants
[Things the model must not violate]
- Do not change the database schema except X.
- Do not introduce a new dependency.

## 8. Non-Goals / Forbidden Changes
[Separate from constraints to prevent scope creep]
This task does NOT include:
- Refactoring the authentication system
- Changing UI styling

## 9. Files/Components Expected to Change
| File | Expected Change | Reason |
|------|-----------------|--------|
| `src/...` | Modify | Add feature logic |
| `tests/...` | Add | Feature tests |
*(Note: This list is expected, not an absolute restriction if implementation requires another file)*

## 10. Interfaces and Contracts
[Precise boundaries between components]
- **Input:** `{"name": string}`
- **Output:** `201 {"id": string}`
- **API Contracts / Functions / Events:** ...

## 11. Edge Cases and Failure Behavior
[What should happen when things go wrong]
- If user already exists → return 409.
- If input is missing → return 400.

## 12. Testing Requirements
[What needs to be tested and what behavior must be demonstrated]
- Unit tests for X
- Integration tests for Y

## 13. Existing Behavior That Must Remain Unchanged
[Regression requirements]
- Existing login flow must continue working.
- Existing response format must remain unchanged.

## 14. Dependencies and Assumptions
[Explicit assumptions the plan relies on]
- Assumptions: Authentication middleware already provides `req.user`.
*(If an assumption turns out to be false, the agent MUST stop rather than invent a replacement)*

## 15. Decision Points / Prohibited Autonomous Decisions
If an implementation decision is required that is not specified by this plan, do not invent a new requirement. Flag the issue instead.
**UNRESOLVED DECISIONS:**
- None

## 16. Validation Commands
[Exact commands the coding agent should run to verify its work]
- `npm run test`
- `npm run lint`

## 17. Expected Final State
[Describe the repository after successful implementation. "If I inspect the repository after the agent finishes, what should I find?"]

## 18. Agent Instructions / Execution Rules
1. Implement only this plan.
2. Do not expand the scope.
3. Do not implement features mentioned elsewhere in the repository unless required by this plan.
4. Prefer existing project patterns over introducing new patterns.
5. Do not make architectural changes without explicit authorization.
6. Do not modify unrelated files.
7. If the plan conflicts with the existing implementation, stop and report the conflict rather than guessing.
8. If a requirement is ambiguous, stop and report it.
9. Do not mark the task complete until every acceptance criterion passes.
