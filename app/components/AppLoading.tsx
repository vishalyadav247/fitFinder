// SpareFit loading screen (boot/nav behaviour as in ChatConvert; our own mark). Two jobs:
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
/** Keep in step with the .sp-load--leaving transition in app-loading.css. */
const FADE_MS = 260;

/**
 * SpareFit's own mark: a tiny search that "finds the fit". Three field pills fill in, the
 * search button pulses, a lens sweeps the product tiles and settles on the one that fits, which
 * lights up with a tick. Abstract shapes only, so it suits every store type.
 */
function LoadingMark({ label, hints }: { label: string; hints?: boolean }) {
  return (
    <div className="sp-load__inner">
      <div className="sp-load__panel" aria-hidden="true">
        <div className="sp-load__fields">
          <span className="sp-load__field sp-load__field--1">
            <i />
          </span>
          <span className="sp-load__field sp-load__field--2">
            <i />
          </span>
          <span className="sp-load__field sp-load__field--3">
            <i />
          </span>
          <span className="sp-load__go">
            <svg viewBox="0 0 24 24">
              <circle cx="10.5" cy="10.5" r="6" />
              <path d="M15 15l5 5" />
            </svg>
          </span>
        </div>
        <div className="sp-load__tiles">
          <span className="sp-load__tile sp-load__tile--miss" />
          <span className="sp-load__tile sp-load__tile--fit">
            <b className="sp-load__tick">
              <svg viewBox="0 0 24 24">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </b>
          </span>
          <span className="sp-load__tile sp-load__tile--miss" />
          <span className="sp-load__lens" />
        </div>
      </div>

      <div className="sp-load__name">
        Spare<span>Fit</span>
      </div>
      {hints && (
        <div className="sp-load__hints" aria-hidden="true">
          <span>Reading your search fields</span>
          <span>Matching products</span>
          <span>Almost ready</span>
        </div>
      )}
      <div className="sp-load__status" role="status" aria-live="polite">
        {label}
        <span className="sp-load__dot" />
        <span className="sp-load__dot" />
        <span className="sp-load__dot" />
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
        className={`sp-load sp-load--boot${boot === "leaving" ? " sp-load--leaving" : ""}`}
        aria-hidden={boot === "leaving" ? true : undefined}
      >
        <LoadingMark label="Opening SpareFit" hints />
      </div>
    );
  }

  if (!navVisible) return null;

  return (
    <div className="sp-load sp-load--nav">
      <LoadingMark label="Loading your page" />
    </div>
  );
}
