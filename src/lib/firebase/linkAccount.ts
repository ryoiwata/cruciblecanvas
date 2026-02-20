/**
 * linkAccount — helpers for linking an anonymous Firebase session to a
 * permanent Google account.
 *
 * Firebase preserves the UID when linking, so all Firestore documents created
 * under the anonymous session (boards, objects) remain accessible after linking.
 */

import { GoogleAuthProvider, linkWithPopup, signInWithPopup } from 'firebase/auth';
import type { Auth, UserCredential } from 'firebase/auth';

/**
 * Links the current anonymous Firebase user to a Google account via popup.
 * If the current user is already authenticated (non-anonymous), falls back to
 * a regular sign-in so the function is safe to call in any auth state.
 *
 * @throws `auth/popup-blocked` — browser blocked the popup (user gesture required)
 * @throws `auth/credential-already-in-use` — Google account already linked to another user
 */
export async function linkAnonymousToGoogle(auth: Auth): Promise<UserCredential> {
  const provider = new GoogleAuthProvider();
  const currentUser = auth.currentUser;

  if (currentUser?.isAnonymous) {
    // Preserve the anonymous UID by linking rather than signing in fresh.
    return linkWithPopup(currentUser, provider);
  }

  // Fallback: not anonymous — just sign in normally.
  return signInWithPopup(auth, provider);
}
