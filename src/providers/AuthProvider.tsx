"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/config";
import { useAuthStore } from "@/lib/store/authStore";

export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const setUser = useAuthStore((s) => s.setUser);
  const setDisplayName = useAuthStore((s) => s.setDisplayName);
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // Safety timeout: if Firebase Auth doesn't resolve within 5 seconds
    // (e.g. slow cold start, hanging token refresh, or blocked storage),
    // unblock the UI so the user isn't stuck on an infinite loading screen.
    const authTimeout = setTimeout(() => {
      if (useAuthStore.getState().isLoading) {
        // Firebase auth did not resolve in time — unblock the UI so the user
        // can navigate to sign-in instead of being stuck on a loading screen.
        console.warn(
          "[AuthProvider] Firebase auth timed out after 5 s. " +
            "Treating session as unauthenticated. Check network and Firebase config."
        );
        setUser(null);
      }
    }, 5000);

    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        clearTimeout(authTimeout);
        setUser(firebaseUser);

        // For anonymous users, recover the guest display name from Firestore
        // (the Zustand store only has in-memory state which is lost on refresh)
        if (firebaseUser?.isAnonymous && !firebaseUser.displayName) {
          try {
            const profileDoc = await getDoc(
              doc(db, "users", firebaseUser.uid, "profile", "info")
            );
            const name = profileDoc.data()?.displayName;
            if (name) {
              setDisplayName(name);
            }
          } catch {
            // Profile may not exist yet — ignore
          }
        }
      });
    } catch (err) {
      // If auth subscription setup fails (e.g. invalid auth instance),
      // unblock the UI immediately so the user can navigate to sign-in.
      clearTimeout(authTimeout);
      console.error("[AuthProvider] Failed to subscribe to auth state:", err);
      setUser(null);
    }

    return () => {
      clearTimeout(authTimeout);
      unsubscribe?.();
    };
  }, [setUser, setDisplayName]);

  useEffect(() => {
    if (isLoading) return;
    if (!user && pathname === "/dashboard") {
      router.replace("/auth");
    }
  }, [user, isLoading, pathname, router]);

  return <>{children}</>;
}
