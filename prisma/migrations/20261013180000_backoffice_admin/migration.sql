-- Backoffice profile (agreed 2026-10-13): the super admin can change name, email and password;
-- stored here (scrypt hash) instead of only in the environment.

-- CreateTable
CREATE TABLE "backoffice_admins" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backoffice_admins_pkey" PRIMARY KEY ("id")
);
