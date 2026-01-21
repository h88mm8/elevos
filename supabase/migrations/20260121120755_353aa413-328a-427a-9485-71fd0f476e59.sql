-- ============================================
-- PART 1: Create helper function to validate phone numbers
-- IDs @lid from WhatsApp have 14-15+ digits and are NOT valid phone numbers
-- Valid phone numbers: 10-13 digits (with country code)
-- ============================================
CREATE OR REPLACE FUNCTION public.is_valid_phone(identifier TEXT) 
RETURNS BOOLEAN 
LANGUAGE plpgsql
IMMUTABLE
SET search_path = 'public'
AS $$
BEGIN
  IF identifier IS NULL OR identifier = '' THEN 
    RETURN FALSE; 
  END IF;
  
  -- Remove non-digits for validation
  DECLARE
    digits TEXT := regexp_replace(identifier, '\D', '', 'g');
  BEGIN
    -- IDs @lid have 14-15+ digits and don't start with valid country codes
    -- Brazilian numbers start with 55 and can be up to 13 digits
    IF LENGTH(digits) > 13 AND LEFT(digits, 2) != '55' THEN 
      RETURN FALSE; 
    END IF;
    
    -- Valid phone numbers: 10-13 digits (with country code)
    RETURN LENGTH(digits) >= 10 AND LENGTH(digits) <= 15;
  END;
END;
$$;

-- ============================================
-- PART 2: Clean up invalid @lid entries from chats table
-- Delete records where attendee_identifier looks like an internal ID
-- ============================================
DELETE FROM public.chats 
WHERE attendee_identifier IS NOT NULL 
  AND attendee_identifier != ''
  AND NOT is_valid_phone(attendee_identifier);

-- ============================================
-- PART 3: Deduplicate chats by phone number
-- Keep only the most recent chat for each (workspace_id, attendee_identifier)
-- ============================================
DELETE FROM public.chats c1
USING public.chats c2
WHERE c1.workspace_id = c2.workspace_id
  AND c1.attendee_identifier = c2.attendee_identifier
  AND c1.attendee_identifier IS NOT NULL
  AND c1.attendee_identifier != ''
  AND c1.id != c2.id
  AND (
    c1.last_message_at < c2.last_message_at 
    OR (c1.last_message_at = c2.last_message_at AND c1.created_at < c2.created_at)
  );

-- ============================================
-- PART 4: Add UNIQUE constraint on messages for idempotency
-- This prevents duplicate messages from webhook retries
-- First, remove any existing duplicates
-- ============================================
DELETE FROM public.messages m1
USING public.messages m2
WHERE m1.workspace_id = m2.workspace_id
  AND m1.external_id = m2.external_id
  AND m1.external_id IS NOT NULL
  AND m1.id != m2.id
  AND m1.created_at < m2.created_at;

-- Now add the unique constraint
ALTER TABLE public.messages 
ADD CONSTRAINT messages_workspace_external_id_unique 
UNIQUE (workspace_id, external_id);

-- ============================================
-- PART 5: Create index for fast phone-based lookups
-- ============================================
CREATE INDEX IF NOT EXISTS idx_chats_workspace_attendee 
ON public.chats (workspace_id, attendee_identifier)
WHERE attendee_identifier IS NOT NULL AND attendee_identifier != '';