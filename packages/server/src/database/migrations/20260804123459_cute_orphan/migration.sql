ALTER TABLE "session_participants" ADD COLUMN "is_bot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "session_participants" ALTER COLUMN "user_id" DROP NOT NULL;