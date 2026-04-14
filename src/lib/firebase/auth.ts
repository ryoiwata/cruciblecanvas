import {
  signInAnonymously,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  linkWithPopup,
  signOut,
  AuthProvider,
  AuthError,
  UserCredential,
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./config";

async function writeUserProfile(credential: UserCredential): Promise<void> {
  const user = credential.user;
  const profileRef = doc(db, "users", user.uid, "profile", "info");
  await setDoc(
    profileRef,
    {
      displayName: user.displayName || null,
      email: user.email || null,
      photoURL: user.photoURL || null,
      isAnonymous: user.isAnonymous,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function signInAsGuest(): Promise<UserCredential> {
  const credential = await signInAnonymously(auth);
  await writeUserProfile(credential);
  return credential;
}

/** Popup-blocked or unauthorized-domain errors that should trigger redirect fallback. */
const REDIRECT_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/popup-closed-by-user',
  'auth/unauthorized-domain',
]);

/**
 * Signs in with Google, trying popup first and falling back to redirect
 * when the popup is blocked or the domain isn't authorized for popups.
 */
export async function signInWithGoogle(): Promise<UserCredential> {
  const provider = new GoogleAuthProvider();
  try {
    const credential = await signInWithPopup(auth, provider);
    await writeUserProfile(credential);
    return credential;
  } catch (err) {
    const code = (err as AuthError)?.code;
    if (code && REDIRECT_FALLBACK_CODES.has(code)) {
      // Popup failed — fall back to full-page redirect flow
      await signInWithRedirect(auth, provider);
      // signInWithRedirect navigates away; this line is never reached.
      // The result is picked up by handleGoogleRedirectResult on reload.
      return undefined as unknown as UserCredential;
    }
    throw err;
  }
}

/**
 * Checks for a pending Google redirect result on page load.
 * Should be called once in the auth page component on mount.
 * Returns the credential if a redirect sign-in just completed, or null otherwise.
 */
export async function handleGoogleRedirectResult(): Promise<UserCredential | null> {
  const result = await getRedirectResult(auth);
  if (result) {
    await writeUserProfile(result);
  }
  return result;
}

export async function signInWithEmail(
  email: string,
  password: string
): Promise<UserCredential> {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  await writeUserProfile(credential);
  return credential;
}

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string
): Promise<UserCredential> {
  const credential = await createUserWithEmailAndPassword(
    auth,
    email,
    password
  );
  await updateProfile(credential.user, { displayName });
  await writeUserProfile(credential);
  return credential;
}

export async function linkAnonymousAccount(
  provider: AuthProvider
): Promise<UserCredential | null> {
  if (!auth.currentUser) return null;
  const credential = await linkWithPopup(auth.currentUser, provider);
  await writeUserProfile(credential);
  return credential;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

/**
 * Updates the current user's display name in both Firebase Auth and Firestore.
 *
 * The name is trimmed and capped at 25 characters before persisting. RTDB
 * presence propagates automatically: `useMultiplayer` re-runs its setPresence
 * effect whenever `authStore.displayName` changes, which callers must update
 * via `useAuthStore.getState().setDisplayName(trimmed)` after this resolves.
 *
 * @param newDisplayName - The desired display name (trimmed, max 25 chars).
 */
export async function updateUserProfile(newDisplayName: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('No authenticated user');

  const trimmed = newDisplayName.trim().slice(0, 25);
  await updateProfile(user, { displayName: trimmed });

  const profileRef = doc(db, 'users', user.uid, 'profile', 'info');
  await setDoc(profileRef, { displayName: trimmed }, { merge: true });
}

/**
 * Persists the user's preferred cursor/avatar color to their Firestore profile.
 * This is the source-of-truth for cross-board color persistence — RTDB color
 * updates are ephemeral and only affect the current board session.
 *
 * @param color - A hex color string from the CURSOR_COLORS palette.
 */
export async function updatePreferredColor(color: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('No authenticated user');

  const profileRef = doc(db, 'users', user.uid, 'profile', 'info');
  await setDoc(profileRef, { preferredColor: color }, { merge: true });
}

/**
 * Reads the user's preferred color from their Firestore profile.
 * Returns null when no preference has been saved (falls back to UID hash color).
 */
export async function loadPreferredColor(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;

  const profileRef = doc(db, 'users', user.uid, 'profile', 'info');
  const snap = await getDoc(profileRef);
  if (!snap.exists()) return null;
  return (snap.data().preferredColor as string | undefined) ?? null;
}
