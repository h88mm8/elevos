-- Add LinkedIn configuration fields to workspace_settings
ALTER TABLE public.workspace_settings
ADD COLUMN linkedin_daily_message_limit integer NOT NULL DEFAULT 50,
ADD COLUMN linkedin_daily_invite_limit integer NOT NULL DEFAULT 25,
ADD COLUMN linkedin_message_interval_seconds integer NOT NULL DEFAULT 30;