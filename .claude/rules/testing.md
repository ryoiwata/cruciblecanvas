# Testing Conventions

## Current State
- The project has a `tests/` directory with `resize-ghosting-test.ts` as an early proof-of-concept test
- No testing framework is configured in `package.json` yet; tests should be added as the project matures

## Recommended Setup (when adding tests)
- Use **Vitest** for unit/integration tests (compatible with Vite/Next.js, fast HMR-style watch mode)
- Use **React Testing Library** for component tests
- Use **Playwright** for end-to-end tests targeting canvas interactions

## What to Test
- **Canvas logic**: resize calculations, snap-to-grid, z-index ordering, frame nesting (`useFrameNesting`)
- **Store reducers**: Zustand store actions for object creation, deletion, and updates
- **Firebase sync hooks**: mock Firestore/RTDB and assert correct read/write paths
- **API routes**: `src/app/api/boards/new/route.ts` — test auth guard, board creation, and error cases
- **Presence & locking**: optimistic lock acquisition and release via `useLockSync`

## What Not to Test
- Third-party library internals (Konva, Firebase SDK)
- Trivial getters/setters with no logic
- Tailwind class names or visual styling

## Test File Placement
- Unit tests: co-located alongside source files as `*.test.ts` / `*.test.tsx`
- Integration tests: `tests/integration/`
- E2E tests: `tests/e2e/`

## Conventions
- Test descriptions use plain English: `it('snaps object to nearest grid point when within threshold')`
- Arrange–Act–Assert structure within each test
- Mock Firebase with `vi.mock` (Vitest) or manual mocks; never hit live Firestore in unit tests
- Use `fireEvent` / `userEvent` from React Testing Library for interaction tests; avoid direct DOM manipulation
- Keep tests deterministic: freeze time with `vi.useFakeTimers()` where timestamps matter

## CI
- All tests must pass before merging to `main`
- Lint (`next lint`) and type-check (`tsc --noEmit`) are treated as test gates
