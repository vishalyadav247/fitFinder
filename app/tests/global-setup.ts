// Unit project global setup: the Postgres integration tests expect the seeded plans, but the
// plans table is shared with the dev database, where the super admin edits them. Set the seeded
// values for the run and put the edited ones back afterwards. Nothing to do without a database.
export async function setup() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env: rely on the environment
  }
  if (!process.env.DATABASE_URL) return;
  const { seedPlansForRun } = await import("./seeded-plans");
  const restore = await seedPlansForRun();
  return async () => {
    await restore();
    const { default: prisma } = await import("../db.server");
    await prisma.$disconnect();
  };
}
