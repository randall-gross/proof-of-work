# Quality Contract

This contract defines the minimum quality bar for any code change. An AI agent MUST satisfy all applicable checklist items before claiming a task is complete.

---

## 1. Error Handling

- [ ] All async operations are wrapped in try/catch (or use `.catch()`)
- [ ] User-facing error messages are clear, non-technical, and actionable
- [ ] Retry logic is present where transient failures are expected (network, external APIs)
- [ ] All function inputs are validated before use
- [ ] HTTP responses use correct status codes (4xx for client errors, 5xx for server errors)

---

## 2. UI Completeness

- [ ] Loading state is implemented for all async data fetches
- [ ] Error state is displayed to the user when a request fails
- [ ] Empty state is handled (not just a blank or broken layout)
- [ ] Forms show inline validation errors and prevent invalid submission
- [ ] Destructive actions (delete, reset, overwrite) require explicit user confirmation
- [ ] Layout is responsive across mobile, tablet, and desktop breakpoints
- [ ] Interactive elements are keyboard-navigable and have visible focus indicators

---

## 3. Code Hygiene

- [ ] No `TODO`, `FIXME`, or `HACK` comments left in committed code
- [ ] No hardcoded secrets, API keys, tokens, or credentials
- [ ] No `console.log`, `console.warn`, or `console.error` left in production paths
- [ ] No unused imports or dead variable declarations
- [ ] No commented-out code blocks (remove or document why they exist)

---

## 4. Security

- [ ] All user-supplied input is sanitized before use in queries, HTML, or commands
- [ ] Authentication and authorization checks are present on every protected route/endpoint
- [ ] No secrets or sensitive values are exposed to the client/browser
- [ ] Forms and mutating endpoints are protected against CSRF where applicable

---

## 5. Testing

- [ ] All new functions and modules have at least one unit test
- [ ] Edge cases (empty input, null, boundary values) are covered by tests
- [ ] All existing tests pass without modification after this change
- [ ] Integration tests updated if the change affects an API contract or data flow

---

## 6. Project-Specific Rules

> Add custom standards for your project below. These are enforced alongside the sections above.

- [ ] _(Define your project-specific rule here)_
- [ ] _(Define your project-specific rule here)_
- [ ] _(Define your project-specific rule here)_
