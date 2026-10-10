-- Additive rollout for an existing Signal PostgreSQL database.
-- No existing tables, token records or wallet links are modified.
BEGIN;
CREATE TABLE IF NOT EXISTS "UserProfile" (
  "id" TEXT NOT NULL,
  "ownerAddress" TEXT NOT NULL,
  "ownerChain" "Chain" NOT NULL,
  "username" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "bio" TEXT NOT NULL DEFAULT '',
  "avatar" TEXT NOT NULL DEFAULT '',
  "banner" TEXT NOT NULL DEFAULT '',
  "accent" TEXT NOT NULL DEFAULT '#8b5cf6',
  "theme" TEXT NOT NULL DEFAULT 'aurora',
  "roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "website" TEXT NOT NULL DEFAULT '',
  "twitter" TEXT NOT NULL DEFAULT '',
  "telegram" TEXT NOT NULL DEFAULT '',
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "showWallet" BOOLEAN NOT NULL DEFAULT false,
  "showProjects" BOOLEAN NOT NULL DEFAULT false,
  "featuredTokenAddress" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserProfile_ownerAddress_ownerChain_fkey" FOREIGN KEY ("ownerAddress", "ownerChain") REFERENCES "Wallet"("address", "chain") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserProfile_username_format" CHECK ("username" ~ '^[a-z][a-z0-9_]{2,23}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserProfile_username_key" ON "UserProfile"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "UserProfile_ownerAddress_ownerChain_key" ON "UserProfile"("ownerAddress", "ownerChain");
COMMIT;
