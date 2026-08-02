CREATE TYPE "session_status" AS ENUM('lobby', 'active', 'ended', 'abandoned');--> statement-breakpoint
CREATE TABLE "session_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"player_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"display_name" varchar(50) NOT NULL,
	"seat_number" integer NOT NULL,
	"is_ready" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"status" "session_status" DEFAULT 'lobby'::"session_status" NOT NULL,
	"join_code_hash" varchar(64) NOT NULL UNIQUE,
	"max_players" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "state_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"session_id" uuid NOT NULL,
	"state_version" integer NOT NULL,
	"turn_number" integer NOT NULL,
	"schema_version" integer NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turn_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"session_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"expected_state_version" integer NOT NULL,
	"actions" jsonb NOT NULL,
	"result_state_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_subject" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_subject_key" UNIQUE("auth_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "session_participants_session_user_unique" ON "session_participants" ("session_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_participants_session_seat_unique" ON "session_participants" ("session_id","seat_number");--> statement-breakpoint
CREATE UNIQUE INDEX "session_participants_session_player_unique" ON "session_participants" ("session_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "state_snapshots_session_version_unique" ON "state_snapshots" ("session_id","state_version");--> statement-breakpoint
CREATE UNIQUE INDEX "turn_submissions_session_submission_unique" ON "turn_submissions" ("session_id","submission_id");--> statement-breakpoint
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "state_snapshots" ADD CONSTRAINT "state_snapshots_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "turn_submissions" ADD CONSTRAINT "turn_submissions_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "turn_submissions" ADD CONSTRAINT "turn_submissions_participant_id_session_participants_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "session_participants"("id") ON DELETE CASCADE;