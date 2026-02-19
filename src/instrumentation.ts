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
  // Instrumentation is observability-only and must never block local startup.
  // Skip in dev to avoid compiling heavy Node-only telemetry dependencies
  // during the first request/hydration path.
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  // NodeSDK is Node.js-only; skip in Edge or browser environments.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  // Missing keys are expected in some environments; startup should continue.
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    return;
  }

  try {
    // Use an opaque runtime import so Next.js does not statically resolve these
    // Node-only dependencies while compiling instrumentation for non-Node runtimes.
    const dynamicImport = new Function("m", "return import(m)") as (
      moduleName: string
    ) => Promise<Record<string, unknown>>;

    const { NodeSDK } = (await dynamicImport("@opentelemetry/sdk-node")) as {
      NodeSDK: new (options: { spanProcessors: unknown[] }) => { start: () => void };
    };
    const { LangfuseSpanProcessor } = (await dynamicImport("@langfuse/otel")) as {
      LangfuseSpanProcessor: new () => unknown;
    };

    const sdk = new NodeSDK({
      spanProcessors: [new LangfuseSpanProcessor()],
    });

    sdk.start();
  } catch (err) {
    // OTel/Langfuse initialization is non-critical — log and continue
    // so that server startup and request handling are not blocked.
    console.warn("[Instrumentation] OpenTelemetry setup failed:", err);
  }
}
