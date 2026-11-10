-- CreateEnum
CREATE TYPE "LinkStatus" AS ENUM ('pending', 'blocked', 'error', 'page_gone', 'lost', 'nofollow', 'noindex', 'anchor_changed', 'ok');

-- CreateTable
CREATE TABLE "Link" (
    "id" TEXT NOT NULL,
    "donorUrl" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "anchor" TEXT,
    "outreacher" TEXT,
    "priceUsd" INTEGER,
    "placedAt" TIMESTAMP(3),
    "status" "LinkStatus" NOT NULL DEFAULT 'pending',
    "failStreak" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3),
    "statusChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Check" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "httpCode" INTEGER,
    "finalUrl" TEXT,
    "status" "LinkStatus" NOT NULL,
    "issues" JSONB NOT NULL,
    "proxy" TEXT,
    "durationMs" INTEGER,

    CONSTRAINT "Check_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Link_status_idx" ON "Link"("status");

-- CreateIndex
CREATE INDEX "Link_outreacher_idx" ON "Link"("outreacher");

-- CreateIndex
CREATE UNIQUE INDEX "Link_donorUrl_targetUrl_key" ON "Link"("donorUrl", "targetUrl");

-- CreateIndex
CREATE INDEX "Check_linkId_checkedAt_idx" ON "Check"("linkId", "checkedAt");

-- AddForeignKey
ALTER TABLE "Check" ADD CONSTRAINT "Check_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;
