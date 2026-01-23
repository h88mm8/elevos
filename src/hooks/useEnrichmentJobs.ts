import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface EnrichmentJob {
  id: string;
  workspace_id: string;
  user_id: string;
  apify_run_id: string;
  lead_ids: string[];
  total_leads: number;
  enriched_count: number;
  error_count: number;
  status: 'processing' | 'completed' | 'failed' | 'quota_exceeded';
  mode: 'profile_only' | 'profile_with_email';
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export function useEnrichmentJobs() {
  const { currentWorkspace } = useAuth();

  const {
    data: jobs,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["enrichment-jobs", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return [];

      const { data, error } = await supabase
        .from("enrichment_jobs")
        .select("*")
        .eq("workspace_id", currentWorkspace.id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      return data as EnrichmentJob[];
    },
    enabled: !!currentWorkspace?.id,
    refetchInterval: 10000, // Poll every 10 seconds for active jobs
  });

  // Get IDs of leads currently being enriched
  const enrichingLeadIds = new Set<string>();
  jobs?.forEach(job => {
    if (job.status === 'processing') {
      job.lead_ids.forEach(id => enrichingLeadIds.add(id));
    }
  });

  // Check if a specific lead is being enriched
  const isLeadEnriching = (leadId: string) => enrichingLeadIds.has(leadId);

  // Get active (processing) jobs
  const activeJobs = jobs?.filter(j => j.status === 'processing') || [];

  return {
    jobs,
    activeJobs,
    isLoading,
    refetch,
    isLeadEnriching,
    enrichingLeadIds: Array.from(enrichingLeadIds),
  };
}
