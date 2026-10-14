// Building blocks of the backoffice (styles/backoffice.css): the colour blobs behind the glass,
// line icons, a spinner, Shopify-admin style toasts and the contextual save bar ("Unsaved
// changes" · Discard · Save) that edit pages show while the form has changes.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useBlocker, useNavigation } from "react-router";

export function Blobs() {
  return (
    <>
      <div className="bo-blob bo-blob--1" aria-hidden="true" />
      <div className="bo-blob bo-blob--2" aria-hidden="true" />
      <div className="bo-blob bo-blob--3" aria-hidden="true" />
    </>
  );
}

const PATHS = {
  logo: "M4 7l8-4 8 4-8 4-8-4zm0 5l8 4 8-4M4 17l8 4 8-4",
  plans: "M4 5h16v4H4zM4 11h10v8H4zM16 11h4v8h-4z",
  overview: "M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  clock: "M12 21a9 9 0 110-18 9 9 0 010 18zM12 7v5l3 2",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  key: "M15 7a4 4 0 11-3.9 4.9L4 19v2h3v-2h2v-2h2l1.1-1.1A4 4 0 0115 7zM16 8h.01",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
  back: "M15 6l-6 6 6 6",
  edit: "M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4",
  check: "M5 12l5 5L20 7",
  alert:
    "M12 8v5M12 16h.01M10.3 3.9L2.5 17.5A2 2 0 004.2 20.5h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  money: "M12 3v18M16.5 7H10a3 3 0 000 6h4a3 3 0 010 6H7",
  gauge: "M4 18a8 8 0 1116 0M12 18l4-6",
  spark:
    "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  info: "M12 8h.01M11 12h1v5h1M12 21a9 9 0 110-18 9 9 0 010 18z",
  store: "M4 9l1.5-5h13L20 9M4 9h16v11H4zM9 20v-6h6v6",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export const Spinner = () => <span className="bo-spinner" aria-hidden="true" />;

export interface ToastMessage {
  text: string;
  error?: boolean;
  /** Changes for every new toast, so the same text can show twice. */
  id: number;
}

let toastId = 0;
export const toast = (text: string, error = false): ToastMessage => ({
  text,
  error,
  id: ++toastId,
});

/** Shopify admin style toast: bottom centre, dark, hides after 5 s (errors 8 s) or on ×. */
export function Toast({
  message,
  onDone,
}: {
  message: ToastMessage | null;
  onDone?: () => void;
}) {
  const [shown, setShown] = useState(message);
  useEffect(() => {
    setShown(message);
    if (!message) return;
    const t = setTimeout(
      () => {
        setShown(null);
        onDone?.();
      },
      message.error ? 8000 : 5000,
    );
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!shown) return null;
  return (
    <div
      key={shown.id}
      className={`bo-toast${shown.error ? " bo-toast--error" : ""}`}
      role={shown.error ? "alert" : "status"}
    >
      <span>{shown.text}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          setShown(null);
          onDone?.();
        }}
      >
        ×
      </button>
    </div>
  );
}

/**
 * Tracks whether a form has changes (any input or change event). While it has, leaving the page
 * is blocked (the save bar shakes, like Shopify's) and closing the tab asks first.
 */
export function useDirtyForm(formRef: RefObject<HTMLFormElement | null>) {
  const [dirty, setDirty] = useState(false);
  const [shake, setShake] = useState(0);
  const navigation = useNavigation();
  const submitting =
    navigation.state !== "idle" && navigation.formMethod != null;

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const mark = () => setDirty(true);
    form.addEventListener("input", mark);
    form.addEventListener("change", mark);
    return () => {
      form.removeEventListener("input", mark);
      form.removeEventListener("change", mark);
    };
  }, [formRef]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !submitting &&
      currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state === "blocked") {
      setShake((n) => n + 1);
      blocker.reset();
    }
  }, [blocker]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const discard = useCallback(() => {
    formRef.current?.reset();
    setDirty(false);
  }, [formRef]);

  return { dirty, setDirty, discard, shake, submitting };
}

/** Shopify-style contextual save bar, shown at the top while the form has changes. */
export function SaveBar({
  formId,
  visible,
  saving,
  shake,
  onDiscard,
  message = "Unsaved changes",
  saveLabel = "Save",
}: {
  formId: string;
  visible: boolean;
  saving: boolean;
  shake: number;
  onDiscard: () => void;
  message?: string;
  saveLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shake || !ref.current) return;
    const el = ref.current;
    el.classList.remove("is-shaking");
    void el.offsetWidth; // restart the animation
    el.classList.add("is-shaking");
  }, [shake]);
  if (!visible && !saving) return null;
  return (
    <div
      ref={ref}
      className="bo-savebar"
      role="region"
      aria-label="Unsaved changes"
    >
      <span className="bo-savebar-msg">
        <Icon name="alert" size={18} />
        {saving ? "Saving…" : message}
      </span>
      <div className="bo-savebar-actions">
        <button
          type="button"
          className="bo-btn bo-btn--sm bo-btn--light"
          onClick={onDiscard}
          disabled={saving}
        >
          Discard
        </button>
        <button
          type="submit"
          form={formId}
          className="bo-btn bo-btn--sm bo-btn--primary"
          disabled={saving}
        >
          {saving && <Spinner />}
          {saving ? "Saving…" : saveLabel}
        </button>
      </div>
    </div>
  );
}
