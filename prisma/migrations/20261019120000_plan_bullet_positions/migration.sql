-- Where each extra card line sits among the generated plan lines: bullets_at[i] = how many
-- generated lines come before bullets[i]. Missing (older plans): after the generated lines.
ALTER TABLE "plans" ADD COLUMN "bullets_at" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
