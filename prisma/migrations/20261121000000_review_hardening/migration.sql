-- A review job whose commit is no longer the pull request head (a newer push arrived) is marked superseded.
ALTER TYPE "ReviewJobStatus" ADD VALUE 'superseded';

-- Store severity as an enum instead of free text. Existing values were already validated
-- against these four values by the response parser, so the cast keeps every row.
CREATE TYPE "ReviewSeverity" AS ENUM ('critical', 'high', 'medium', 'low');

ALTER TABLE "ReviewFinding"
ALTER COLUMN "severity" TYPE "ReviewSeverity"
USING ("severity"::"ReviewSeverity");
