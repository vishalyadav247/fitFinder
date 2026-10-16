import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { type EntryContext } from "react-router";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { jobsRunInline, startWorkers } from "./services/jobs.server";
import { installLogCapture } from "./services/logs/logs.server";

// Warnings and errors also go to Backoffice › Logs (services/logs/logs.server.ts).
installLogCapture();

// Background jobs (imports) run in this process unless JOBS_INLINE=false (then: npm run worker).
// startWorkers() is idempotent per process.
if (jobsRunInline()) void startWorkers();

export const streamTimeout = 5000;

/** Errors no route handled (loaders, actions, rendering), with the path, for the logs. */
export function handleError(error: unknown, { request }: { request: Request }) {
  // A request the browser gave up on isn't an app error.
  if (request.signal.aborted) return;
  const url = new URL(request.url);
  console.error("route: unhandled error", {
    path: `${request.method} ${url.pathname}`,
    shop: url.searchParams.get("shop") ?? undefined,
    error,
  });
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      },
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
