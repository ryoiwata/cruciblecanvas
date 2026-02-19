import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getDatabase, type Database } from "firebase/database";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);

// Guard RTDB init: getDatabase() throws "Cannot parse Firebase url: undefined" when
// databaseURL is missing, which would crash the entire module and break auth.
// Initialise only when the URL is present; log a clear warning otherwise.
let rtdbInstance: Database | null = null;
if (firebaseConfig.databaseURL) {
  rtdbInstance = getDatabase(app);
} else if (typeof window !== "undefined") {
  console.warn(
    "[Firebase] NEXT_PUBLIC_FIREBASE_DATABASE_URL is not set. " +
      "Realtime Database features (presence, cursors, locks) will not work. " +
      "Set this environment variable to your RTDB URL, e.g. https://<project-id>-default-rtdb.firebaseio.com"
  );
}

// Cast to Database — consumers that use rtdb must only be called when RTDB is configured.
export const rtdb = rtdbInstance as Database;
export default app;
