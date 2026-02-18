# Security Requirements

## Authentication
- All board and object access requires Firebase Authentication (`request.auth != null` in Firestore rules)
- Never expose raw Firebase Admin credentials to the client; Admin SDK is server-only
- Firebase config keys (`NEXT_PUBLIC_FIREBASE_*`) are public by design but must never include the Admin service account key
- Session state is managed by Firebase Auth; do not implement custom session tokens

## Authorization (Firestore Rules)
- Access model: a board is accessible to authenticated users if it is public, the requester is the creator, or their email is in `invitedEmails`
- Board metadata (`boards/{boardId}/metadata/config`) is readable by any authenticated user but only writable by the creator
- User profiles (`users/{userId}/profile/info`) are scoped strictly to the owning user
- Any change to `firestore.rules` must be validated with `firebase_validate_security_rules` before deploying
- Never use `allow read, write: if true` in production rules

## Environment Variables
- All secrets are loaded via environment variables; never hard-code API keys, database URLs, or credentials in source files
- `.env.local` must be listed in `.gitignore` and must never be committed
- Validate that `NEXT_PUBLIC_FIREBASE_DATABASE_URL` is set before enabling RTDB features (already guarded in `src/lib/firebase/config.ts`)

## API Routes
- Server-side API routes (`src/app/api/`) must verify Firebase ID tokens using the Admin SDK before trusting the caller's identity
- Reject requests with missing or malformed tokens with HTTP 401
- Validate and sanitize all user-supplied input (board titles, object text, etc.) before writing to Firestore

## Client-Side Safety
- Sanitize any user-generated text before rendering as HTML (avoid `dangerouslySetInnerHTML` without explicit sanitization)
- Canvas text content rendered via Konva is inherently safe (not injected as HTML), but validate length/type before persisting
- AI-generated content must be treated as untrusted user input: validate schema, length, and type before writing objects to Firestore

## Rate Limiting
- AI commands are rate-limited via `aiCommandsToday` and `aiCommandsResetAt` fields on `BoardMetadata`
- Enforce the rate limit on the server side (API route), not only on the client
- Reset logic must use server timestamps, not client-supplied timestamps

## Realtime Database (RTDB)
- RTDB is used for ephemeral data only: cursors, presence, and object locks (`database.rules.json`)
- RTDB rules must require authentication and scope writes to the authenticated user's own data
- Object locks must have a TTL mechanism to prevent stale locks after disconnection

## Dependency Security
- Run `npm audit` periodically; address high/critical vulnerabilities promptly
- Pin major versions in `package.json`; use `package-lock.json` for deterministic installs
- Do not add dependencies that include Firebase Admin or other server-only secrets in client bundles
