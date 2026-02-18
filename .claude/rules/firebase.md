---
paths:
  - "src/lib/firebase/**"
  - "firestore.rules"
  - "database.rules.json"
---
# Firebase Interaction Rules

## BaaS-First Architecture
- Firebase is a Backend as a Service — favor direct client-side SDK calls to Firestore/RTDB for standard CRUD operations (reads, writes, subscriptions).
- Do **not** route standard data operations through an intermediate Next.js API route. The client should talk directly to Firebase.
- Server-side API routes (`src/app/api/`) are reserved for operations that genuinely require a trusted server context: AI tool execution, third-party service calls, or actions requiring Admin SDK privileges (e.g., bypassing rules for AI-generated writes).

## Security via Rules, Not Middleware
- All authentication and authorization for client-originated requests must be enforced in `firestore.rules` and `database.rules.json`.
- Do not replicate Firestore security logic in server-side code for operations the client performs directly — the rules are the source of truth.
- Never use `allow read, write: if true` in production rules.
- Any change to security rules must be validated with `firebase_validate_security_rules` before deploying.

## Environment Variables
- `NEXT_PUBLIC_FIREBASE_*` variables are public by design and safe to expose to the browser.
- Service account private keys (`FIREBASE_ADMIN_SERVICE_ACCOUNT`, `FIREBASE_ADMIN_PRIVATE_KEY`) are server-only secrets and must **never** appear in `NEXT_PUBLIC_*` vars or client bundles.
- The Admin SDK must only be initialized in server-side code (API routes, server components).

## Emulator-First Development
- Use the Firebase Emulator Suite locally (`firebase emulators:start`) to validate security rules before deploying to production.
- Test rule changes against the Firestore and RTDB emulators; never validate rules by deploying to live production.
- Emulator ports: Firestore 8080, RTDB 9000, Auth 9099 (defaults).

## When the Admin SDK IS Appropriate
- AI tool execution that must bypass per-user Firestore rules (e.g., creating objects on behalf of the user).
- Server-side token verification (`verifyIdToken`) to authenticate API route callers.
- Batch operations that require elevated privileges not grantable via security rules.
