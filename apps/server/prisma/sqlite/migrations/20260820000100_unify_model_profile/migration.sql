ALTER TABLE "ModelProfile" ADD COLUMN "modelName" TEXT NOT NULL DEFAULT '';

UPDATE "ModelProfile"
SET "modelName" = COALESCE(
  (SELECT "currentModelName" FROM "HarnessSettings" WHERE "currentModelProfileId" = "ModelProfile"."id" LIMIT 1),
  (SELECT "modelName" FROM "ModelCatalogEntry" WHERE "profileId" = "ModelProfile"."id" ORDER BY "createdAt" ASC LIMIT 1),
  "displayName"
);
