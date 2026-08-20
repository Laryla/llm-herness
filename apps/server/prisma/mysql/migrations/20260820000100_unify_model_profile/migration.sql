ALTER TABLE `ModelProfile` ADD COLUMN `modelName` VARCHAR(191) NOT NULL DEFAULT '';

UPDATE `ModelProfile` AS profile
SET `modelName` = COALESCE(
  (SELECT `currentModelName` FROM `HarnessSettings` WHERE `currentModelProfileId` = profile.`id` LIMIT 1),
  (SELECT `modelName` FROM `ModelCatalogEntry` WHERE `profileId` = profile.`id` ORDER BY `createdAt` ASC LIMIT 1),
  profile.`displayName`
);
