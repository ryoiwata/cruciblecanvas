import {
  signInAnonymously,
  signInWithPopup,
  GoogleAuthProvider,
  GithubAuthProvider,
  linkWithPopup,
  signOut,
  AuthProvider,
  UserCredential,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
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

export async function signInWithGoogle(): Promise<UserCredential> {
  const provider = new GoogleAuthProvider();
  const credential = await signInWithPopup(auth, provider);
  await writeUserProfile(credential);
  return credential;
}

export async function signInWithGithub(): Promise<UserCredential> {
  const provider = new GithubAuthProvider();
  const credential = await signInWithPopup(auth, provider);
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
