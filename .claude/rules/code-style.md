# Code Style Guidelines

## Language & Framework

- **TypeScript:** Use strict mode via `tsconfig.json` with Next.js 14 App Router.
- **React:** Use React 18 functional components only — no class components.
- **Styling:** Use Tailwind CSS for all styling; avoid inline styles and CSS modules.

---

## TypeScript

- **Explicit Typing:** All functions and component props must be explicitly typed.
- **Interfaces vs. Types:** Prefer `interface` for object shapes (`BoardObject`, `BoardMetadata`, etc.); use `type` for unions and aliases.
- **Constants:** Use `as const` for constant literal objects (e.g., `SHAPE_DEFAULTS`, `STICKY_NOTE_COLORS`).
- **No `any`:** Use `unknown` with narrowing or define proper types in `src/lib/types.ts`.
- **Safety:** Avoid non-null assertions (`!`) unless the value is guaranteed by control flow; prefer optional chaining.

---

## Naming Conventions

| Category | Convention | Example |
|----------|------------|---------|
| Variables & Functions | Descriptive, intention-revealing | `calculateClampedStageZoom` not `calcZoom` |
| Booleans | Prefix with `is`, `has`, or `should` | `isObjectLocked`, `shouldTriggerRollback` |
| Files | `camelCase.ts` or `PascalCase.tsx` | `useFirestoreSync.ts`, `Canvas.tsx` |
| React Components | `PascalCase` | `PresencePanel`, `CursorLayer` |
| Hooks | `use` prefix + `camelCase` | `useFirestoreSync`, `usePresenceSync` |
| Constants | `SCREAMING_SNAKE_CASE` | `GRID_SIZE`, `ZOOM_MAX` |
| Types & Interfaces | `PascalCase` | `BoardObject`, `PresenceData` |
| Store Slices | Suffix with `Store` | `canvasStore`, `objectStore` |

---

## Component Structure

- **Module-Level Documentation:** Every major file (hook, store, or component) must start with a brief JSDoc comment describing its responsibility in the system.
- **UI Components:** Co-locate UI components under `src/components/ui/`.
- **Logic Separation:** Keep page components in `src/app/` thin; push logic into hooks or stores.
- **Hooks:** Custom hooks live in `src/hooks/`.
- **Utilities:** Firebase and library utilities live in `src/lib/`.

---

## State Management

- **Zustand:** Use Zustand stores (`src/lib/store/`) for global app state.
- **Performance:** Prefer fine-grained selectors to avoid unnecessary re-renders.
- **Syncing:** Optimistic updates are acceptable; always reconcile with Firestore on sync.

---

## Imports

- **Absolute Imports:** Use absolute imports via the `@/` alias (configured in `tsconfig.json` path mapping).
- **Grouping:** Order imports as follows:
  1. React / Next.js
  2. Third-party libraries
  3. Internal modules
  4. Types

---

## Formatting

- **ESLint:** Use `next/core-web-vitals` + `next/typescript`.
- **Linting:** Run `next lint` before committing; do not suppress lint errors with inline disable comments.
- **Style:** Use trailing commas, 2-space indentation, and single quotes for strings.

---

## Comments & Documentation

- **The "Why", Not the "What":** Comments should explain the reasoning behind complex architectural choices or edge-case handling — not restate what the code obviously does.
- **JSDoc for Public APIs:** Use JSDoc for all exported functions to describe parameters, return types, and potential side effects.
- **Complex Math:** Explicitly document canvas math, coordinate transformations, and concurrency logic.
- **Dividers:** Use section dividers (`// ----`) to organize large files like `types.ts`.