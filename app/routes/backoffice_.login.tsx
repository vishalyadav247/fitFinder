// Backoffice sign-in (specs/backoffice.md). One super admin from the environment; 5 failed
// sign-ins per IP (50 in all) per 15 minutes, then sign-in waits.
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import {
  data,
  Form,
  redirect,
  useActionData,
  useNavigation,
} from "react-router";
import { z } from "zod";
import {
  checkOrigin,
  clearFailures,
  clientIp,
  requireConfig,
  checkCredentials,
  signedIn,
  startAttempt,
  startSession,
} from "../services/backoffice-auth.server";
import { Blobs, Icon, Spinner } from "../components/backoffice/ui";
import styles from "../styles/backoffice.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];
export const meta: MetaFunction = () => [
  { title: "Sign in · SpareFit backoffice" },
  { name: "robots", content: "noindex, nofollow" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  requireConfig();
  if (await signedIn(request)) throw redirect("/backoffice");
  return null;
};

const Input = z.object({
  email: z.string().trim().toLowerCase().max(200),
  password: z.string().max(200),
});

const WRONG = "The email or password is wrong.";

export const action = async ({ request }: ActionFunctionArgs) => {
  requireConfig();
  checkOrigin(request);
  const ip = clientIp(request);
  // Counted before any await, so parallel guesses can't all pass the lockout check.
  if (!startAttempt(ip)) {
    return data(
      { error: "Too many failed sign-ins. Try again in 15 minutes." },
      { status: 429 },
    );
  }
  const parsed = Input.safeParse(Object.fromEntries(await request.formData()));
  // Both checks always run, so timing doesn't tell whether the email was right.
  const admin = parsed.success
    ? await checkCredentials(parsed.data.email, parsed.data.password)
    : null;
  if (!admin) {
    console.warn("backoffice: failed sign-in", { ip });
    return data({ error: WRONG }, { status: 401 });
  }
  clearFailures(ip);
  return startSession(request, admin);
};

export default function BackofficeLogin() {
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  // Busy from the post until the redirect lands (the plans page then replaces this one).
  const busy = navigation.state !== "idle";
  return (
    <div className="bo">
      <Blobs />
      <div className="bo-login">
        <Form method="post" className="bo-glass bo-login-card">
          <span className="bo-logo">
            <Icon name="logo" size={26} />
          </span>
          <h1 className="bo-title">SpareFit backoffice</h1>
          <p className="bo-sub">Sign in to manage plans.</p>
          {result?.error && (
            <p className="bo-banner" role="alert">
              <Icon name="info" />
              {result.error}
            </p>
          )}
          <label className="bo-field">
            <span className="bo-label">Email</span>
            <input
              className="bo-input"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              required
            />
          </label>
          <label className="bo-field">
            <span className="bo-label">Password</span>
            <input
              className="bo-input"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••••••"
              required
            />
          </label>
          <button
            type="submit"
            className="bo-btn bo-btn--primary bo-btn--block"
            disabled={busy}
          >
            {busy && <Spinner />}
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="bo-login-foot">
            Super admin only · sessions last 8 hours
          </p>
        </Form>
      </div>
    </div>
  );
}
