-- AlterTable: Add telegram_chat_id to users
ALTER TABLE "users" ADD COLUMN "telegram_chat_id" TEXT;

-- CreateIndex: Unique constraint on telegram_chat_id
CREATE UNIQUE INDEX "users_telegram_chat_id_key" ON "users"("telegram_chat_id");
