/**
 * firestoreRest.ts — Edge-compatible Firebase Firestore REST API helpers.
 * Used by AI tools in the Edge runtime where firebase-admin is unavailable.
 *
 * All writes are authenticated with the requesting user's Firebase ID token,
 * meaning they flow through Firestore Security Rules — no admin bypass needed.
 * Reads/writes succeed as long as the user has board access (canAccessBoard rule).
 */

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ---------------------------------------------------------------------------
// Firestore REST value codec
// ---------------------------------------------------------------------------

type FirestoreField =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: FirestoreField[] } }
  | { mapValue: { fields?: Record<string, FirestoreField> } };

function encodeValue(val: unknown): FirestoreField {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(encodeValue) } };
  if (typeof val === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(val as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, encodeValue(v)])
        ),
      },
    };
  }
  return { stringValue: String(val) };
}

function decodeValue(field: FirestoreField): unknown {
  if ('nullValue' in field) return null;
  if ('booleanValue' in field) return field.booleanValue;
  if ('integerValue' in field) return parseInt(field.integerValue, 10);
  if ('doubleValue' in field) return field.doubleValue;
  if ('stringValue' in field) return field.stringValue;
  // Convert Firestore timestamps to milliseconds (compatible with Timestamp | number union)
  if ('timestampValue' in field) return new Date(field.timestampValue).getTime();
  if ('arrayValue' in field) return field.arrayValue.values?.map(decodeValue) ?? [];
  if ('mapValue' in field) {
    return Object.fromEntries(
      Object.entries(field.mapValue.fields ?? {}).map(([k, v]) => [k, decodeValue(v)])
    );
  }
  return null;
}

function encodeDocument(data: Record<string, unknown>): { fields: Record<string, FirestoreField> } {
  return {
    fields: Object.fromEntries(
      Object.entries(data)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, encodeValue(v)])
    ),
  };
}

function decodeDocument(doc: {
  fields?: Record<string, FirestoreField>;
}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(doc.fields ?? {}).map(([k, v]) => [k, decodeValue(v)])
  );
}

// ---------------------------------------------------------------------------
// HTTP wrapper
// ---------------------------------------------------------------------------

async function firestoreFetch(
  url: string,
  method: string,
  token: string,
  body?: unknown
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Firestore REST ${method} → ${res.status}: ${errText}`);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Board object CRUD — replaces admin.ts functions for Edge runtime
// ---------------------------------------------------------------------------

/**
 * Creates a board object document via REST API.
 * Uses the caller's ID token so Security Rules apply (user must have board access).
 */
export async function restCreateObject(
  boardId: string,
  data: Record<string, unknown> & { id: string },
  token: string
): Promise<string> {
  const now = new Date().toISOString();
  const doc = encodeDocument({ ...data, createdAt: now, updatedAt: now });
  const url = `${FIRESTORE_BASE}/boards/${boardId}/objects?documentId=${encodeURIComponent(data.id)}`;
  await firestoreFetch(url, 'POST', token, doc);
  return data.id;
}

/**
 * Updates fields on an existing board object. Strips immutable fields and sets updatedAt.
 */
export async function restUpdateObject(
  boardId: string,
  objectId: string,
  updates: Record<string, unknown>,
  token: string
): Promise<void> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (k !== 'id' && k !== 'createdAt' && k !== 'createdBy' && v !== undefined) {
      cleaned[k] = v;
    }
  }
  cleaned.updatedAt = new Date().toISOString();

  const doc = encodeDocument(cleaned);
  // Build field mask so only provided fields are overwritten
  const fieldMask = Object.keys(cleaned)
    .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
    .join('&');
  const url = `${FIRESTORE_BASE}/boards/${boardId}/objects/${objectId}?${fieldMask}`;
  await firestoreFetch(url, 'PATCH', token, doc);
}

/**
 * Deletes a board object.
 */
export async function restDeleteObject(
  boardId: string,
  objectId: string,
  token: string
): Promise<void> {
  const url = `${FIRESTORE_BASE}/boards/${boardId}/objects/${objectId}`;
  await firestoreFetch(url, 'DELETE', token);
}

/**
 * Fetches all objects for a board using Firestore's runQuery endpoint.
 * Capped at 500 documents per request.
 */
export async function restGetObjects(
  boardId: string,
  token: string
): Promise<Array<Record<string, unknown>>> {
  const url = `${FIRESTORE_BASE}/boards/${boardId}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'objects' }],
      limit: 500,
    },
  };

  const res = await firestoreFetch(url, 'POST', token, body);
  const items = (await res.json()) as Array<{
    document?: { fields?: Record<string, FirestoreField>; name?: string };
  }>;

  return items
    .filter((item) => item.document?.fields)
    .map((item) => decodeDocument(item.document!));
}

/**
 * Batch-updates multiple objects in parallel.
 * REST API replacement for adminBatchUpdate (Firestore batch writes).
 * Sequential semantics aren't guaranteed, but for layout operations this is acceptable.
 */
export async function restBatchUpdateObjects(
  boardId: string,
  updates: { id: string; data: Record<string, unknown> }[],
  token: string
): Promise<void> {
  await Promise.all(
    updates.map(({ id, data }) => restUpdateObject(boardId, id, data, token))
  );
}
