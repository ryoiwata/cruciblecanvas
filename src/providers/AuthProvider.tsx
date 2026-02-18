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
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
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
    return () => unsubscribe();
  }, [setUser, setDisplayName]);

  useEffect(() => {
    if (isLoading) return;
    if (!user && pathname === "/dashboard") {
      router.replace("/auth");
    }
  }, [user, isLoading, pathname, router]);

  return <>{children}</>;
}
