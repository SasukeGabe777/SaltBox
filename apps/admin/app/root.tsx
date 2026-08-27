import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { Route } from "./+types/root";
import "./styles/admin.css";

export const links: Route.LinksFunction = () => [
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&family=Inter:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <div className="ambient ambient-one" aria-hidden="true" />
        <div className="ambient ambient-two" aria-hidden="true" />
        <header className="app-header">
          <div className="app-shell header-inner">
            <Link className="brand" to="/" aria-label="SaltBox Prospect Intelligence home">
              <span className="brand-mark" aria-hidden="true" />
              <span>SaltBox</span>
            </Link>
            <div className="header-context">
              <span className="live-dot" aria-hidden="true" />
              <span>LOCAL OPERATOR VIEW</span>
            </div>
          </div>
        </header>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Viewer unavailable";
  let message = "SaltBox could not load this operator view.";
  let hint = "Check that Docker and local PostgreSQL are running, then refresh.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Prospect not found";
      message = "That prospect does not exist in the local SaltBox database.";
      hint = "Return to the prospect overview and choose a current record.";
    } else if (error.status === 400) {
      title = "Invalid prospect link";
      message = "The prospect identifier in this URL is malformed.";
      hint = "Return to the prospect overview and open the record again.";
    } else if (error.status === 503) {
      title = "Database unavailable";
      message = "The admin viewer cannot reach local PostgreSQL right now.";
    }
  }

  return (
    <main id="main-content" className="app-shell error-page">
      <p className="eyebrow">OPERATOR NOTICE</p>
      <h1>{title}</h1>
      <p>{message}</p>
      <p className="muted">{hint}</p>
      <Link className="button button-primary" to="/">Return to overview</Link>
    </main>
  );
}
