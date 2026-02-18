/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Loads src/instrumentation.ts at server startup for OpenTelemetry init.
    // In Next.js 15+, this is enabled by default and the flag is not needed.
    instrumentationHook: true,
  },
};

export default nextConfig;
