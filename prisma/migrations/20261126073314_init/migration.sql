-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('FALL', 'HELP_REQUEST');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "CommandAction" AS ENUM ('REBOOT', 'REQUEST_LOCATION');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('PENDING', 'OK', 'EXPIRED');

-- CreateTable
CREATE TABLE "DeviceState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "firmware" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "bootedAt" TIMESTAMP(3),
    "uptimeS" INTEGER,
    "signal" INTEGER,
    "imuOk" BOOLEAN,
    "gpsFix" BOOLEAN,
    "contactsCnt" INTEGER,
    "heap" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyContact" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "sync" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "type" "IncidentType" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "confidence" DOUBLE PRECISION,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "gpsValid" BOOLEAN NOT NULL DEFAULT false,
    "gpsAgeS" INTEGER,
    "deviceTime" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "ackedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "eventId" TEXT,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsDelivery" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT,
    "phone" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "deviceTime" TIMESTAMP(3),
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "valid" BOOLEAN NOT NULL,
    "ageS" INTEGER,
    "source" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandLog" (
    "id" TEXT NOT NULL,
    "action" "CommandAction" NOT NULL,
    "status" "CommandStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CommandLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceHealthLog" (
    "id" TEXT NOT NULL,
    "signal" INTEGER,
    "imuOk" BOOLEAN,
    "gpsFix" BOOLEAN,
    "heap" INTEGER,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceHealthLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushToken" (
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyContact_phone_key" ON "EmergencyContact"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_eventId_key" ON "Incident"("eventId");

-- CreateIndex
CREATE INDEX "Incident_receivedAt_idx" ON "Incident"("receivedAt");

-- CreateIndex
CREATE INDEX "Incident_status_idx" ON "Incident"("status");

-- CreateIndex
CREATE INDEX "SmsDelivery_incidentId_idx" ON "SmsDelivery"("incidentId");

-- CreateIndex
CREATE INDEX "Location_at_idx" ON "Location"("at");

-- CreateIndex
CREATE INDEX "CommandLog_status_expiresAt_idx" ON "CommandLog"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "DeviceHealthLog_at_idx" ON "DeviceHealthLog"("at");

-- AddForeignKey
ALTER TABLE "SmsDelivery" ADD CONSTRAINT "SmsDelivery_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;
