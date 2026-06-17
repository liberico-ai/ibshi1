ALTER TABLE "template_steps" ADD COLUMN "next_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "template_steps" ADD COLUMN "gate_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
