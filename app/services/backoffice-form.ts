// The backoffice plan form as planInputSchema's input: checkboxes are "on" when ticked, a ticked
// "unlimited" box makes the limit null, card lines are one per row. Pure.
import { LIMIT_KEYS, TOGGLE_KEYS } from "./plan-features";

export function formToPlanInput(form: FormData) {
  const text = (k: string) => String(form.get(k) ?? "");
  const on = (k: string) => form.get(k) === "on";
  return {
    name: text("name"),
    description: text("description"),
    visible: on("visible"),
    isFree: on("isFree"),
    // Free plans have no price fields in the form.
    priceMonthly: text("priceMonthly") || "0",
    priceYearly: text("priceYearly").trim() === "" ? null : text("priceYearly"),
    trialDays: text("trialDays") || "0",
    limits: Object.fromEntries(
      LIMIT_KEYS.map((k) => [
        k,
        // An empty box is refused ("Enter a whole number."), not saved as 0.
        on(`unlimited.${k}`) ? null : text(`limit.${k}`).trim() || undefined,
      ]),
    ),
    toggles: Object.fromEntries(TOGGLE_KEYS.map((k) => [k, on(`toggle.${k}`)])),
    bullets: text("bullets").split(/\r?\n/),
  };
}
