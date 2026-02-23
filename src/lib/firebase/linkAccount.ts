/**
 * linkAccount — helpers for linking an anonymous Firebase session to a
 * permanent Google account.
 *
 * Firebase preserves the UID when linking succeeds, so all Firestore documents
 * created under the anonymous session (boards, objects) remain accessible after
 * linking.
 *
 * Conflict handling: if the Google account is already a Firebase user
 * (auth/credential-already-in-use), we extract the Google credential from the
 * error and sign the user into that existing account. Their anonymous boards
 * remain accessible via shared URLs if the boards are public.
 */

import {
  GoogleAuthProvider,
  linkWithPopup,
  signInWithPopup,
  signInWithCredential,
} from 'firebase/auth';
import type { Auth, AuthError, UserCredential } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './config';

/**
 * Writes (or merges) the authenticated user's profile into Firestore after
 * a successful link or sign-in. Keeps the profile document in sync with the
 * Firebase Auth identity.
 */
async function syncProfileAfterAuth(credential: UserCredential): Promise<void> {
  const user = credential.user;
  const profileRef = doc(db, 'users', user.uid, 'profile', 'info');
  await setDoc(
    profileRef,
    {
      displayName: user.displayName || null,
      email: user.email || null,
      photoURL: user.photoURL || null,
      isAnonymous: false,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Links the current anonymous Firebase user to a Google account via popup.
 *
 * - If linking succeeds, the UID is preserved and the Firestore profile is updated.
 * - If the Google account already exists (`auth/credential-already-in-use`), the
 *   user is signed into that existing account instead. The UID changes but the
 *   board remains accessible if it is public.
 * - If not currently anonymous, falls back to a regular Google sign-in.
 *
 * @throws `auth/popup-blocked` — browser blocked the popup (user gesture required)
 */
export async function linkAnonymousToGoogle(auth: Auth): Promise<UserCredential> {
  const provider = new GoogleAuthProvider();
  const currentUser = auth.currentUser;

  if (currentUser?.isAnonymous) {
    try {
      const credential = await linkWithPopup(currentUser, provider);
      await syncProfileAfterAuth(credential);
      return credential;
    } catch (err) {
      const error = err as AuthError;
      if (error.code === 'auth/credential-already-in-use') {
        // Extract the Google credential from the error and sign in to the
        // existing account. onAuthStateChanged will flip isAnonymous → false.
        const googleCredential = GoogleAuthProvider.credentialFromError(error);
        if (!googleCredential) throw error;
        const result = await signInWithCredential(auth, googleCredential);
        await syncProfileAfterAuth(result);
        return result;
      }
      throw error;
    }
  }

  // Already authenticated (non-anonymous) — just sign in with Google.
  const credential = await signInWithPopup(auth, provider);
  await syncProfileAfterAuth(credential);
  return credential;
}
