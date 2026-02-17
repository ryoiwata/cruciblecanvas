import {
  signInAnonymously,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
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
