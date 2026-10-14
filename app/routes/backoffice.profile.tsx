// Backoffice › Profile: the super admin's name, sign-in email and password (specs/backoffice.md).
// Saved in backoffice_admins (password hashed on the server); until the first save the env
// values sign in. Every save needs the current password. Changing the email or password signs
// out other sessions; this one gets a fresh session.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  Form,
  useActionData,
  useLoaderData,
  useSearchParams,
} from "react-router";
import { z } from "zod";
import {
  checkOrigin,
  ProfileError,
  requireAdmin,
  startSession,
  updateProfile,
} from "../services/backoffice-auth.server";
import { MIN_PASSWORD } from "../services/backoffice-shared";
import {
  Icon,
  SaveBar,
  Toast,
  toast,
  useDirtyForm,
  type IconName,
  type ToastMessage,
} from "../components/backoffice/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const admin = await requireAdmin(request);
  return {
    name: admin.name,
    email: admin.email,
    fromEnv: admin.source === "env",
  };
};

const Input = z
  .object({
    name: z.string().trim().max(80, "Use 80 characters or fewer."),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Enter a valid email address.")
      .max(200),
    currentPassword: z
      .string()
      .min(1, "Enter your current password to save.")
      .max(200),
    newPassword: z.string().max(200),
    confirmPassword: z.string().max(200),
  })
  .superRefine((v, ctx) => {
    if (v.newPassword && v.newPassword.length < MIN_PASSWORD) {
      ctx.addIssue({
        code: "custom",
        path: ["newPassword"],
        message: `Use at least ${MIN_PASSWORD} characters.`,
      });
    }
    if (v.newPassword !== v.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "The passwords don't match.",
      });
    }
  });

type ActionResult = { error: string; errors: Record<string, string> };

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireAdmin(request);
  checkOrigin(request);
  const form = Object.fromEntries(await request.formData());
  const parsed = Input.safeParse({
    name: form.name ?? "",
    email: form.email ?? "",
    currentPassword: form.currentPassword ?? "",
    newPassword: form.newPassword ?? "",
    confirmPassword: form.confirmPassword ?? "",
  });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      errors[String(issue.path[0])] ??= issue.message;
    }
    return data<ActionResult>(
      { errors, error: "Check the highlighted fields." },
      { status: 400 },
    );
  }
  try {
    const admin = await updateProfile(parsed.data);
    console.info("backoffice: profile saved", { email: admin.email });
    // A fresh session for the new email / version; other sessions are signed out.
    return startSession(request, admin, "/backoffice/profile?saved=1");
  } catch (error) {
    if (error instanceof ProfileError) {
      return data<ActionResult>(
        { errors: { [error.field]: error.message }, error: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
};

function FieldError({ message }: { message?: string }) {
  return message ? <span className="bo-error">{message}</span> : null;
}

function SectionTitle({
  icon,
  children,
}: {
  icon: IconName;
  children: string;
}) {
  return (
    <h2 className="bo-section-title">
      <span className="bo-chip-icon">
        <Icon name={icon} size={16} />
      </span>
      {children}
    </h2>
  );
}

export default function Profile() {
  const { name, email, fromEnv } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const errors = result?.errors ?? {};
  const formRef = useRef<HTMLFormElement>(null);
  const { dirty, setDirty, discard, shake, submitting } = useDirtyForm(formRef);
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState<ToastMessage | null>(null);
  const savedToast = useMemo(
    () => (params.get("saved") ? toast("Profile saved") : null),
    [params],
  );

  useEffect(() => {
    if (result?.error) setNotice(toast(result.error, true));
  }, [result]);
  // A successful save reloads with fresh values: the form is clean again.
  useEffect(() => {
    if (savedToast) {
      formRef.current?.reset();
      setDirty(false);
    }
  }, [savedToast, setDirty]);

  const cls = (key: string) => `bo-input${errors[key] ? " has-error" : ""}`;

  return (
    <Form method="post" id="profile-form" ref={formRef} key={email}>
      <SaveBar
        formId="profile-form"
        visible={dirty}
        saving={submitting}
        shake={shake}
        onDiscard={discard}
      />
      <Toast message={notice} />
      <Toast
        message={savedToast}
        onDone={() =>
          setParams(
            (p) => {
              p.delete("saved");
              return p;
            },
            { replace: true, preventScrollReset: true },
          )
        }
      />

      <div className="bo-head">
        <div>
          <h1 className="bo-title">Profile</h1>
          <p className="bo-sub">Your name, sign-in email and password.</p>
        </div>
      </div>

      {fromEnv && (
        <p className="bo-banner bo-banner--info">
          <Icon name="info" />
          You&apos;re signed in with the email and password from the server
          settings. Save this page once to manage them here; after that, these
          values are used to sign in.
        </p>
      )}

      <div className="bo-form-grid">
        <section className="bo-glass bo-card">
          <SectionTitle icon="user">Account</SectionTitle>
          <label className="bo-field">
            <span className="bo-label">Name</span>
            <input
              className={cls("name")}
              name="name"
              defaultValue={name}
              maxLength={80}
              placeholder="Your name"
              autoComplete="name"
            />
            <FieldError message={errors.name} />
          </label>
          <label className="bo-field">
            <span className="bo-label">Email</span>
            <input
              className={cls("email")}
              name="email"
              type="email"
              defaultValue={email}
              required
              autoComplete="username"
            />
            <span className="bo-help">You sign in with this email.</span>
            <FieldError message={errors.email} />
          </label>
        </section>

        <section className="bo-glass bo-card">
          <SectionTitle icon="key">Change password</SectionTitle>
          <label className="bo-field">
            <span className="bo-label">New password</span>
            <input
              className={cls("newPassword")}
              name="newPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Leave empty to keep it"
            />
            <span className="bo-help">At least {MIN_PASSWORD} characters.</span>
            <FieldError message={errors.newPassword} />
          </label>
          <label className="bo-field">
            <span className="bo-label">Confirm new password</span>
            <input
              className={cls("confirmPassword")}
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
            />
            <FieldError message={errors.confirmPassword} />
          </label>
        </section>

        <section className="bo-glass bo-card bo-card--wide">
          <SectionTitle icon="info">Confirm it&apos;s you</SectionTitle>
          <div className="bo-fields">
            <label className="bo-field">
              <span className="bo-label">Current password</span>
              <input
                className={cls("currentPassword")}
                name="currentPassword"
                type="password"
                autoComplete="current-password"
              />
              <span className="bo-help">
                Needed to save any change. Changing the email or password signs
                out other sessions.
              </span>
              <FieldError message={errors.currentPassword} />
            </label>
          </div>
        </section>
      </div>
    </Form>
  );
}
