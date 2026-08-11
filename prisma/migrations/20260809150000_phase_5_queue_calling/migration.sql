-- Extend the Token lifecycle for queue execution.
ALTER TYPE "TokenStatus" ADD VALUE 'CALLED';
ALTER TYPE "TokenStatus" ADD VALUE 'SERVING';
ALTER TYPE "TokenStatus" ADD VALUE 'COMPLETED';
ALTER TYPE "TokenStatus" ADD VALUE 'SKIPPED';
