"use client";

import { useAuthStore } from "@/lib/store/authStore";

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-4 text-2xl font-bold text-gray-900">Dashboard</h1>
        {user ? (
          <p className="text-gray-600">
            Signed in as {user.displayName || "Guest"} ({user.uid.slice(0, 8)}...)
          </p>
        ) : (
          <p className="text-gray-500">Not signed in. Redirecting...</p>
        )}
      </div>
    </div>
  );
}
