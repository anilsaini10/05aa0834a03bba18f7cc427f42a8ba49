-- Own migration: Postgres can't use a new enum value in the same
-- transaction that adds it (the CHECK in the next migration uses it).
ALTER TYPE "Role" ADD VALUE 'STAFF';
