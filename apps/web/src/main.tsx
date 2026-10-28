import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { ToastProvider } from "./components/Toast";
import { ApiError, setTransport } from "./lib/api";
import { isMockMode } from "./lib/env";
import { setSocketFactory } from "./lib/live";
import { qk } from "./lib/queries";
import "./index.css";

/** Any 401 outside of /api/me → re-check the session; the auth gate then redirects to /login. */
function onError(error: unknown, queryKey?: readonly unknown[]) {
  if (error instanceof ApiError && error.isUnauthorized && queryKey?.[0] !== "me") {
    void queryClient.invalidateQueries({ queryKey: qk.me });
  }
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (e, q) => onError(e, q.queryKey) }),
  mutationCache: new MutationCache({ onError: (e) => onError(e) }),
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

async function bootstrap() {
  if (isMockMode()) {
    const mock = await import("./lib/mock");
    setTransport(mock.mockTransport);
    setSocketFactory(mock.createMockSocket);
  } else if ("serviceWorker" in navigator && "Notification" in window && Notification.permission === "granted") {
    // Keep the push service worker up to date once the user has opted in.
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastProvider>
            <App />
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void bootstrap();
