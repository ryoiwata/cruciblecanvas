/**
 * Next.js instrumentation hook — initializes OpenTelemetry with Langfuse.
 *
 * Next.js calls `register()` once at server startup before handling any requests.
 * Dynamic imports are used to ensure OTel and Langfuse modules are only loaded in
 * the Node.js runtime; Edge workers do not support the NodeSDK.
 *
 * Required env vars (set in .env.local):
 *   LANGFUSE_PUBLIC_KEY  — Langfuse project public key
 *   LANGFUSE_SECRET_KEY  — Langfuse project secret key
 *   LANGFUSE_BASEURL     — optional; defaults to https://cloud.langfuse.com
 *
 * The Vercel AI SDK emits OTel spans automatically when `experimental_telemetry`
 * is enabled on a `streamText` / `generateText` call. The LangfuseSpanProcessor
 * intercepts those spans and forwards them to Langfuse.
 */
export async function register() {
  // NodeSDK is Node.js-only; skip in Edge or browser environments.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { LangfuseSpanProcessor } = await import('@langfuse/otel');

    const sdk = new NodeSDK({
      spanProcessors: [new LangfuseSpanProcessor()],
    });

    sdk.start();
  }
}
