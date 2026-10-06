// FitFinder loading screen (boot/nav behaviour as in ChatConvert; our own mark). Two jobs:
//
//   boot — the server HTML is painted but React hasn't hydrated yet, so the page looks ready
//          while nothing is clickable. An opaque overlay covers that window and fades out once
//          the app is live (at least BOOT_MIN_MS, so a fast open doesn't flicker). If the page
//          never hydrates, app-loading.css fades it out on its own after 10 s.
//
//   nav  — a move to another page takes longer than NAV_DELAY_MS: the same mark on a frosted
//          veil, so the page you came from stays visible.
//
// Not shown for same-page loading (paging a table, revalidation after a save): taking over the
// screen for those would be worse than the tables' own loading states.
import { useEffect, useState } from "react";
import { useLocation, useNavigation } from "react-router";

const BOOT_MIN_MS = 400;
const NAV_DELAY_MS = 300;
/** Keep in step with the .ff-load--leaving transition in app-loading.css. */
const FADE_MS = 260;

/**
 * FitFinder's own mark: a tiny search that "finds the fit". Three field pills fill in, the
 * search button pulses, a lens sweeps the product tiles and settles on the one that fits, which
 * lights up with a tick. Abstract shapes only, so it suits every store type.
 */
function LoadingMark({ label, hints }: { label: string; hints?: boolean }) {
  return (
    <div className="ff-load__inner">
      <div className="ff-load__panel" aria-hidden="true">
        <div className="ff-load__fields">
          <span className="ff-load__field ff-load__field--1">
            <i />
          </span>
          <span className="ff-load__field ff-load__field--2">
            <i />
          </span>
          <span className="ff-load__field ff-load__field--3">
            <i />
          </span>
          <span className="ff-load__go">
            <svg viewBox="0 0 24 24">
              <circle cx="10.5" cy="10.5" r="6" />
              <path d="M15 15l5 5" />
            </svg>
          </span>
        </div>
        <div className="ff-load__tiles">
          <span className="ff-load__tile ff-load__tile--miss" />
          <span className="ff-load__tile ff-load__tile--fit">
            <b className="ff-load__tick">
              <svg viewBox="0 0 24 24">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </b>
          </span>
          <span className="ff-load__tile ff-load__tile--miss" />
          <span className="ff-load__lens" />
        </div>
      </div>

      <div className="ff-load__name">
        Fit<span>Finder</span>
      </div>
      {hints && (
        <div className="ff-load__hints" aria-hidden="true">
          <span>Reading your search fields</span>
          <span>Matching products</span>
          <span>Almost ready</span>
        </div>
      )}
      <div className="ff-load__status" role="status" aria-live="polite">
        {label}
        <span className="ff-load__dot" />
        <span className="ff-load__dot" />
        <span className="ff-load__dot" />
      </div>
    </div>
  );
}

export function AppLoading() {
  const navigation = useNavigation();
  const location = useLocation();

  // "visible" on the server and on the client's first render, so the markup matches and
  // hydration stays clean; the effect below ends it.
  const [boot, setBoot] = useState<"visible" | "leaving" | "done">("visible");
  const [navVisible, setNavVisible] = useState(false);

  useEffect(() => {
    const toLeaving = setTimeout(() => setBoot("leaving"), BOOT_MIN_MS);
    const toDone = setTimeout(() => setBoot("done"), BOOT_MIN_MS + FADE_MS);
    return () => {
      clearTimeout(toLeaving);
      clearTimeout(toDone);
    };
  }, []);

  const changingPage =
    navigation.state === "loading" &&
    !!navigation.location &&
    navigation.location.pathname !== location.pathname;

  useEffect(() => {
    if (!changingPage) {
      setNavVisible(false);
      return;
    }
    const timer = setTimeout(() => setNavVisible(true), NAV_DELAY_MS);
    return () => clearTimeout(timer);
  }, [changingPage]);

  if (boot !== "done") {
    return (
      <div
        className={`ff-load ff-load--boot${boot === "leaving" ? " ff-load--leaving" : ""}`}
        aria-hidden={boot === "leaving" ? true : undefined}
      >
        <LoadingMark label="Opening FitFinder" hints />
      </div>
    );
  }

  if (!navVisible) return null;

  return (
    <div className="ff-load ff-load--nav">
      <LoadingMark label="Loading your page" />
    </div>
  );
}
