import { lazy, Suspense, type ComponentType } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router";
import { ApiError } from "./lib/api";
import { isMockMode } from "./lib/env";
import { useMe } from "./lib/queries";
import { Layout, Logo, PageContainer } from "./components/Layout";
import { LiveProvider } from "./components/LiveProvider";
import { Button, EmptyState, Spinner, buttonClasses } from "./components/ui";
import { LoginPage } from "./pages/Login";
import { ConnectPage } from "./pages/Connect";
import { InboxPage } from "./pages/Inbox";

// Heavier, less-visited pages (QR code, zod-validated editors, previews) load on demand.
const DevicesPage = lazy(() => import("./pages/Devices").then((m) => ({ default: m.DevicesPage })));
const TemplatesPage = lazy(() => import("./pages/Templates").then((m) => ({ default: m.TemplatesPage })));
const SendPage = lazy(() => import("./pages/Send").then((m) => ({ default: m.SendPage })));

function PageFallback() {
  return (
    <div className="flex justify-center py-24">
      <Spinner />
    </div>
  );
}

const lazyEl = (C: ComponentType) => (
  <Suspense fallback={<PageFallback />}>
    <C />
  </Suspense>
);

function Splash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
      <Logo />
      <Spinner />
    </div>
  );
}

function AuthGate() {
  const me = useMe();
  const location = useLocation();

  if (me.error instanceof ApiError && me.error.isUnauthorized) {
    const redirect = location.pathname + location.search;
    return <Navigate to={`/login${redirect !== "/" ? `?redirect=${encodeURIComponent(redirect)}` : ""}`} replace />;
  }
  if (me.data) {
    return (
      <LiveProvider>
        <Layout user={me.data} />
      </LiveProvider>
    );
  }
  if (me.error) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="max-w-md text-center">
          <Logo className="mb-6 justify-center" />
          <h1 className="text-lg font-semibold">Can't reach the Herald server</h1>
          <p className="mt-2 text-sm text-zinc-500">{me.error.message}</p>
          {!isMockMode() && (
            <p className="mt-2 text-sm text-zinc-500">
              Running locally? Start the API with <code className="font-mono">pnpm --filter @herald/server dev</code>, or
              explore with demo data in <a className="text-blue-600 underline dark:text-blue-400" href="/?mock=1">mock mode</a>.
            </p>
          )}
          <Button className="mt-6" variant="primary" onClick={() => void me.refetch()} loading={me.isFetching}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  return <Splash />;
}

function NotFound() {
  return (
    <PageContainer>
      <EmptyState
        title="Page not found"
        actions={
          <Link to="/" className={buttonClasses("primary")}>
            Go home
          </Link>
        }
      >
        That route doesn't exist.
      </EmptyState>
    </PageContainer>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AuthGate />}>
        <Route index element={<ConnectPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="inbox/:id" element={<InboxPage />} />
        <Route path="devices" element={lazyEl(DevicesPage)} />
        <Route path="templates" element={lazyEl(TemplatesPage)} />
        <Route path="send" element={lazyEl(SendPage)} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
