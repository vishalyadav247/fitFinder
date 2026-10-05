// Placeholder page; the screen is built in M3 (see .claude/BUILD-PLAN.md §5).
// The "Change store type" action is live since M2 (specs/search-setup.md).
import { useNavigate } from "react-router";

export default function SearchSetupPage() {
  const navigate = useNavigate();
  return (
    <s-page heading="Search setup" inlineSize="base">
      {/* Title-bar buttons are documented with onClick, not href. */}
      <s-button
        slot="secondary-actions"
        icon="store"
        onClick={() => navigate("/app/onboarding")}
      >
        Change store type
      </s-button>
    </s-page>
  );
}
