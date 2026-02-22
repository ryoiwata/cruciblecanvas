/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Always enable the instrumentation hook so Langfuse traces are captured
    // in both local dev (when LANGFUSE_* keys are in .env.local) and production.
    instrumentationHook: true,
    // Externalize heavy server-only packages from webpack bundling.
    // This prevents Next.js from compiling firebase-admin, OTel, and Langfuse
    // into the server bundle, reducing first-compile time for API routes.
    serverComponentsExternalPackages: [
      "firebase-admin",
      "@opentelemetry/sdk-node",
      "@langfuse/otel",
      "@langfuse/tracing",
    ],
  },
};

export default nextConfig;
