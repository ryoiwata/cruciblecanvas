"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/authStore";
import AuthCard from "@/components/auth/AuthCard";

export default function AuthPage() {
  const user = useAuthStore((s) => s.user);
  const isAnonymous = useAuthStore((s) => s.isAnonymous);
  const isLoading = useAuthStore((s) => s.isLoading);
  const router = useRouter();

  // Redirect to dashboard if already authenticated (skip guests — they go straight to a board)
  useEffect(() => {
    if (!isLoading && user && !isAnonymous) {
      router.replace("/dashboard");
    }
  }, [user, isAnonymous, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (user && !isAnonymous) {
    return null; // Redirect in progress
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <AuthCard />
    </div>
  );
}
