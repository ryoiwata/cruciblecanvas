/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Disable instrumentation in dev to avoid loading OTel/Langfuse and causing
    // startup hang on cold start (rm -rf .next && npm run dev). OTel is only
    // needed for production observability.
    instrumentationHook: process.env.NODE_ENV === "production",
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
