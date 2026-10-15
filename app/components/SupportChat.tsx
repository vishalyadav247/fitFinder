import { useEffect } from "react";

// Live support chat (Progryss chat widget) in the embedded admin; Settings › Help points to it.
// Added after hydration so App Bridge stays the first script on the page, and only once: page
// changes inside the app keep the same widget.
const SRC = "https://chat.progryss.com/widget/v1.js";
const APP_ID = "sparefit-parts-finder";
const ID = "sparefit-support-chat";

export function SupportChat() {
  useEffect(() => {
    if (document.getElementById(ID)) return;
    const script = document.createElement("script");
    script.id = ID;
    script.src = SRC;
    script.async = true;
    script.dataset.appId = APP_ID;
    document.body.appendChild(script);
  }, []);
  return null;
}
