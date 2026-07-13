UPDATE "ReviewJob"
SET "status" = 'processing'
WHERE "status" = 'queued';

ALTER TABLE "ReviewJob" ALTER COLUMN "status" DROP DEFAULT;

ALTER TYPE "ReviewJobStatus" RENAME TO "ReviewJobStatus_old";

CREATE TYPE "ReviewJobStatus" AS ENUM ('processing', 'completed', 'failed');

ALTER TABLE "ReviewJob"
ALTER COLUMN "status" TYPE "ReviewJobStatus"
USING ("status"::text::"ReviewJobStatus");

ALTER TABLE "ReviewJob" ALTER COLUMN "status" SET DEFAULT 'processing';

DROP TYPE "ReviewJobStatus_old";
