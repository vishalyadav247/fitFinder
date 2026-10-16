// Backoffice layout (/backoffice): the super admin's panel outside the Shopify admin
// (specs/backoffice.md). Glass sidebar with the sections (Overview, Plans, Stores, Logs, Profile; a
// new section is one entry in NAV) and the signed-in admin with Sign out. No App Bridge or Polaris here.
import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import {
  Form,
  isRouteErrorResponse,
  Link,
  NavLink,
  Outlet,
  useLoaderData,
  useLocation,
  useNavigation,
  useRouteError,
} from "react-router";
import { requireAdmin } from "../services/backoffice-auth.server";
import { Blobs, Icon, type IconName } from "../components/backoffice/ui";
import styles from "../styles/backoffice.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];
export const meta: MetaFunction = () => [
  { title: "SpareFit backoffice" },
  { name: "robots", content: "noindex, nofollow" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { email, name } = await requireAdmin(request);
  return { email, name };
};

/** Sections in the left navigation; `match` marks the item active on its sub-pages too. */
const NAV: { to: string; label: string; icon: IconName; match?: RegExp }[] = [
  { to: "/backoffice", label: "Overview", icon: "overview" },
  {
    to: "/backoffice/plans",
    label: "Plans",
    icon: "plans",
    match: /^\/backoffice\/plans(\/.*)?$/,
  },
  { to: "/backoffice/stores", label: "Stores", icon: "store" },
  { to: "/backoffice/logs", label: "Logs", icon: "alert" },
  { to: "/backoffice/profile", label: "Profile", icon: "user" },
];

export default function BackofficeLayout() {
  const { email, name } = useLoaderData<typeof loader>();
  const { pathname } = useLocation();
  const navigation = useNavigation();
  const signingOut =
    navigation.state !== "idle" &&
    navigation.formAction === "/backoffice/logout";
  return (
    <div className="bo">
      <Blobs />
      <div className="bo-shell">
        <aside className="bo-side bo-glass" aria-label="Backoffice">
          <Link to="/backoffice" className="bo-brand">
            <span className="bo-logo">
              <Icon name="logo" size={20} />
            </span>
            <span>
              <b>SpareFit</b>
              <small>Backoffice</small>
            </span>
          </Link>
          <p className="bo-nav-label">Manage</p>
          <nav className="bo-nav">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                // Exact match only: "/backoffice" must not stay active on /backoffice/profile.
                end
                className={({ isActive }) =>
                  isActive || item.match?.test(pathname) ? "active" : undefined
                }
              >
                <Icon name={item.icon} />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="bo-side-foot">
            <div className="bo-user" title={email}>
              <span className="bo-avatar">{(name || email).charAt(0)}</span>
              <span>{name || email}</span>
            </div>
            <Form method="post" action="/backoffice/logout">
              <button
                type="submit"
                className="bo-btn bo-btn--ghost bo-btn--sm"
                disabled={signingOut}
              >
                <Icon name="logout" size={16} />
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </Form>
          </div>
        </aside>
        <main className="bo-main">
          <div className="bo-page">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * A backoffice page that failed (a loader or action error): the backoffice's own message, not the
 * merchant-facing one of the root boundary. The detail is in Logs ("route: unhandled error").
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <div className="bo">
      <Blobs />
      <main className="bo-login">
        <div className="bo-glass bo-login-card">
          <h1 className="bo-title">
            {notFound ? "Page not found" : "Something went wrong"}
          </h1>
          <p className="bo-sub">
            {notFound
              ? "This backoffice page doesn't exist."
              : "This page couldn't be loaded. Try again; if it keeps happening, the error is in Logs."}
          </p>
          <a
            href="/backoffice"
            className="bo-btn bo-btn--primary bo-btn--block"
          >
            Back to Overview
          </a>
        </div>
      </main>
    </div>
  );
}
