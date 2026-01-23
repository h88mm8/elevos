-- Remove o constraint antigo
ALTER TABLE public.usage_events 
DROP CONSTRAINT IF EXISTS usage_events_action_check;

-- Recria com todas as actions (incluindo Deep Enrich e client events)
ALTER TABLE public.usage_events
ADD CONSTRAINT usage_events_action_check 
CHECK (action = ANY (ARRAY[
  'linkedin_search_page',
  'linkedin_search_page_blocked',
  'linkedin_enrich',
  'linkedin_enrich_blocked',
  'linkedin_enrich_deep',
  'linkedin_enrich_deep_blocked',
  'upgrade_cta_shown',
  'upgrade_cta_clicked',
  'linkedin_search_blocked'
]));