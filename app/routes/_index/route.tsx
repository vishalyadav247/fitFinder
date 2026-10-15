// The app URL opened outside the Shopify admin: a public landing page. App Store requirement
// 2.3.1: no shop-domain field; the app is installed and opened from Shopify only. Links that carry
// ?shop= go into the app. Layout follows the ChatConvert landing page, in SpareFit's Sky colours.
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, useLoaderData } from "react-router";

import styles from "./styles.module.css";

export const meta: MetaFunction = () => [
  { title: "SpareFit – Parts Finder — find products that fit, for Shopify" },
  {
    name: "description",
    content:
      "SpareFit adds a Year / Make / Model style search to your Shopify store, with any fields you need. Shoppers pick their vehicle, phone or profile and only see the products that fit.",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return {
    // Set APP_STORE_URL once the listing is live; until then the App Store search finds it.
    appStoreUrl:
      process.env.APP_STORE_URL || "https://apps.shopify.com/search?q=SpareFit",
    privacyPolicyUrl: process.env.PRIVACY_POLICY_URL || null
  };
};

type IconProps = { size?: number; d: string };

function Icon({ size = 20, d }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

const ARROW = "M5 12h14M12 5l7 7-7 7";
const LOCK =
  "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4";
const CHECK = "M20 6 9 17l-5-5";
const SEARCH = "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35";

const FEATURES: { tone: string; icon: string; title: string; body: string }[] =
  [
    {
      tone: "sky",
      icon: SEARCH,
      title: "Search by any fields",
      body: "Year, make and model, brand and device, skin type and shade, or anything your catalogue needs. Pick a store type to start and change every field and word after.",
    },
    {
      tone: "indigo",
      icon: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
      title: "Import fitment data from any CSV",
      body: "Upload your supplier's file in whatever column layout it comes in, map the columns, check them, and import. Large files run in the background.",
    },
    {
      tone: "aqua",
      icon: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
      title: "Linked to your products by SKU",
      body: "Fitment rows link to your products automatically by SKU and stay in sync as your catalogue changes. Anything that doesn't match, you link by hand once.",
    },
    {
      tone: "green",
      icon: "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3",
      title: "Fits badge and fitment table",
      body: "Product pages tell shoppers whether a product fits their selection, and can list everything it fits. Add the blocks in the theme editor, no code.",
    },
    {
      tone: "amber",
      icon: "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z",
      title: "My Selection for returning shoppers",
      body: "Shoppers save their vehicle, phone or profile and pick it again with one click on their next visit. Saved in their own browser, never on our servers.",
    },
    {
      tone: "rose",
      icon: "M3 3v18h18M18.7 8l-5.1 5.2-2.8-2.8L7 14.3",
      title: "See what shoppers search for",
      body: "Searches per day, the most searched values, and every search that found nothing, so you know which products or fitment data to add next.",
    },
  ];

export default function App() {
  const { appStoreUrl, privacyPolicyUrl } =
    useLoaderData<typeof loader>();

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              <Icon size={18} d={SEARCH} />
            </span>
            <span className={styles.brandName}>SpareFit</span>
          </div>
          <span className={styles.topPill}>Shopify app</span>
        </header>

        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.heroBadge}>
              <Icon size={15} d={SEARCH} />
              Parts finder for any catalogue
            </span>
            <h1 className={styles.heroHeading}>
              Show shoppers only the products that fit
            </h1>
            <p className={styles.heroText}>
              SpareFit adds a Year / Make / Model style search to your store,
              with any fields you need. Shoppers pick their vehicle, phone or
              profile once and see exactly what fits, on the search, on
              collections and on every product page.
            </p>
          </div>
          <div className={styles.heroCard}>
            <h2 className={styles.cardTitle}>Install SpareFit</h2>
            <p className={styles.cardSub}>
              Install from the Shopify App Store, then add the search to your
              theme in the theme editor. No code.
            </p>
            <a className={styles.primaryButton} href={appStoreUrl}>
              View on the Shopify App Store
              <Icon size={17} d={ARROW} />
            </a>
            <div className={styles.cardDivider} />
            <p className={styles.cardFine}>
              <Icon size={15} d={LOCK} />
              Secure OAuth via Shopify — we never see your password.
            </p>
          </div>
        </section>

        <section className={styles.features} aria-label="Features">
          {FEATURES.map((f) => (
            <article key={f.title} className={styles.featureCard}>
              <span className={`${styles.featureIcon} ${styles[f.tone]}`}>
                <Icon d={f.icon} />
              </span>
              <h3 className={styles.featureTitle}>{f.title}</h3>
              <p className={styles.featureBody}>{f.body}</p>
            </article>
          ))}
        </section>

        <section className={styles.band}>
          <div>
            <h2 className={styles.bandTitle}>Already using SpareFit?</h2>
            <p className={styles.bandSub}>
              Open it from Apps in your Shopify admin to set up your search,
              import fitment data and check your product links.
            </p>
          </div>
          <a className={styles.primaryButton} href="https://admin.shopify.com/">
            Open Shopify admin
            <Icon size={17} d={ARROW} />
          </a>
        </section>

        <p className={styles.trust}>
          <Icon size={16} d={CHECK} />
          <span>Works with Online Store 2.0 themes</span>
          <span className={styles.trustDot} aria-hidden="true">
            ·
          </span>
          <span>Rule-based matching, no guesswork</span>
          <span className={styles.trustDot} aria-hidden="true">
            ·
          </span>
          <span>Built for catalogues with 10,00,000+ fitment rows</span>
        </p>

        <footer className={styles.footer}>
          <span>
            © {new Date().getFullYear()} Progryss Media Private Limited
          </span>
          {privacyPolicyUrl ? (
            <a href={privacyPolicyUrl}>Privacy policy</a>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
