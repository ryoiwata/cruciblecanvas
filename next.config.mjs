/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Enables after() / unstable_after() for post-response callbacks.
    // Required for flushing LangSmith traces after the response stream closes.
    // In Next.js 15+, after() is stable and this flag is not needed.
    after: true,
  },
};

export default nextConfig;
