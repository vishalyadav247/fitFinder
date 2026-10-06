// The app URL opened outside the Shopify admin. App Store requirement 2.3.1: no shop-domain field;
// the app is installed and opened from Shopify only. Links that carry ?shop= go into the app.
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return null;
};

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>FitFinder</h1>
        <p className={styles.text}>
          A &ldquo;find what fits&rdquo; search for your Shopify store: shoppers
          pick their vehicle, phone or profile and only see the products that
          fit.
        </p>
        <p className={styles.text}>
          Install FitFinder from the Shopify App Store, then open it from your
          Shopify admin under Apps.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Search by any fields</strong>. Make, year and model, or
            brand and device, or anything your catalogue needs.
          </li>
          <li>
            <strong>Import your fitment data</strong>. Upload a CSV in any
            column layout and check the columns before importing.
          </li>
          <li>
            <strong>Show it in your theme</strong>. A search section, a fits
            badge and a fitment table on product pages, plus My Selection for
            returning shoppers.
          </li>
        </ul>
      </div>
    </div>
  );
}
