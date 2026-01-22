import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface Plan {
  id: string;
  code: string;
  name: string;
  daily_search_page_limit: number;
  daily_enrich_limit: number;
  monthly_search_page_limit: number | null;
  monthly_enrich_limit: number | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkspacePlan {
  workspace_id: string;
  plan_id: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
  plan?: Plan;
}

export interface WorkspaceUsageToday {
  linkedin_search_pages: number;
  linkedin_enrichments: number;
  linkedin_search_blocked: number;
  linkedin_enrich_blocked: number;
}

export function useWorkspacePlan() {
  const { currentWorkspace } = useAuth();

  // Fetch all plans
  const { 
    data: plans, 
    isLoading: isLoadingPlans 
  } = useQuery({
    queryKey: ["plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("*")
        .order("daily_search_page_limit", { ascending: true });
      
      if (error) throw error;
      return data as Plan[];
    },
  });

  // Fetch workspace's current plan
  const { 
    data: workspacePlan, 
    isLoading: isLoadingWorkspacePlan,
    refetch: refetchWorkspacePlan,
  } = useQuery({
    queryKey: ["workspace-plan", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return null;
      
      const { data, error } = await supabase
        .from("workspace_plans")
        .select(`
          *,
          plan:plans(*)
        `)
        .eq("workspace_id", currentWorkspace.id)
        .maybeSingle();
      
      if (error) throw error;
      
      // If no plan, return default
      if (!data) {
        const defaultPlan = plans?.find(p => p.is_default);
        if (defaultPlan) {
          return {
            workspace_id: currentWorkspace.id,
            plan_id: defaultPlan.id,
            status: 'active',
            starts_at: new Date().toISOString(),
            ends_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            plan: defaultPlan,
          } as WorkspacePlan;
        }
      }
      
      return data as WorkspacePlan;
    },
    enabled: !!currentWorkspace?.id,
  });

  // Fetch today's usage
  const { 
    data: usageToday, 
    isLoading: isLoadingUsage,
    refetch: refetchUsage,
  } = useQuery({
    queryKey: ["workspace-usage-today", currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace?.id) return null;
      
      const { data, error } = await supabase.rpc("get_workspace_usage_today", {
        p_workspace_id: currentWorkspace.id,
      });
      
      if (error) throw error;
      
      const usage: WorkspaceUsageToday = {
        linkedin_search_pages: 0,
        linkedin_enrichments: 0,
        linkedin_search_blocked: 0,
        linkedin_enrich_blocked: 0,
      };
      
      if (data && Array.isArray(data)) {
        for (const row of data) {
          if (row.action === 'linkedin_search_page') {
            usage.linkedin_search_pages = Number(row.total_count);
          } else if (row.action === 'linkedin_enrich') {
            usage.linkedin_enrichments = Number(row.total_count);
          } else if (row.action === 'linkedin_search_page_blocked') {
            usage.linkedin_search_blocked = Number(row.total_count);
          } else if (row.action === 'linkedin_enrich_blocked') {
            usage.linkedin_enrich_blocked = Number(row.total_count);
          }
        }
      }
      
      return usage;
    },
    enabled: !!currentWorkspace?.id,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Get plan limits (from plan or defaults)
  const planLimits = workspacePlan?.plan || plans?.find(p => p.is_default) || {
    daily_search_page_limit: 20,
    daily_enrich_limit: 50,
    monthly_search_page_limit: null,
    monthly_enrich_limit: null,
  };

  return {
    plans,
    workspacePlan,
    usageToday,
    planLimits,
    isLoading: isLoadingPlans || isLoadingWorkspacePlan || isLoadingUsage,
    refetchUsage,
    refetchWorkspacePlan,
  };
}
