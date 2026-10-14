// Backoffice sign-out: a form post (Origin-checked) that ends the session.
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  checkOrigin,
  endSession,
  requireConfig,
} from "../services/backoffice-auth.server";

export const loader = () => {
  requireConfig();
  return redirect("/backoffice");
};

export const action = async ({ request }: ActionFunctionArgs) => {
  requireConfig();
  checkOrigin(request);
  return endSession(request);
};
