import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePlatformAdmin } from "./usePlatformAdmin";

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

export interface WorkspaceWithPlan {
  id: string;
  name: string;
  created_at: string;
  plan?: {
    id: string;
    code: string;
    name: string;
  };
  plan_status?: string;
}

export interface UsageOverview {
  date: string;
  action: string;
  total_count: number;
  unique_workspaces: number;
}

export interface TopWorkspace {
  workspace_id: string;
  workspace_name: string;
  plan_code: string;
  search_pages: number;
  enrichments: number;
}

export interface GlobalAccountUsage {
  account_id: string;
  date: string;
  action: string;
  total_count: number;
}

export function usePlanAdmin() {
  const queryClient = useQueryClient();
  const { isPlatformAdmin } = usePlatformAdmin();

  // Fetch all plans
  const { data: plans, isLoading: isLoadingPlans } = useQuery({
    queryKey: ["admin-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("*")
        .order("daily_search_page_limit", { ascending: true });
      
      if (error) throw error;
      return data as Plan[];
    },
    enabled: isPlatformAdmin === true,
  });

  // Fetch all workspaces with their plans
  const { data: workspaces, isLoading: isLoadingWorkspaces } = useQuery({
    queryKey: ["admin-workspaces-plans"],
    queryFn: async () => {
      // First get all workspaces
      const { data: workspacesData, error: wsError } = await supabase
        .from("workspaces")
        .select("id, name, created_at")
        .order("created_at", { ascending: false });
      
      if (wsError) throw wsError;

      // Then get all workspace_plans
      const { data: plansData, error: plansError } = await supabase
        .from("workspace_plans")
        .select(`
          workspace_id,
          status,
          plan:plans(id, code, name)
        `);
      
      if (plansError) throw plansError;

      // Map plans to workspaces
      const workspacesWithPlans: WorkspaceWithPlan[] = workspacesData.map(ws => {
        const planData = plansData?.find(p => p.workspace_id === ws.id);
        return {
          ...ws,
          plan: planData?.plan as { id: string; code: string; name: string } | undefined,
          plan_status: planData?.status,
        };
      });

      return workspacesWithPlans;
    },
    enabled: isPlatformAdmin === true,
  });

  // Fetch usage overview
  const { data: usageOverview, isLoading: isLoadingUsageOverview } = useQuery({
    queryKey: ["admin-usage-overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_admin_usage_overview", {
        p_days: 7,
      });
      
      if (error) throw error;
      return data as UsageOverview[];
    },
    enabled: isPlatformAdmin === true,
  });

  // Fetch top workspaces
  const { data: topWorkspaces, isLoading: isLoadingTopWorkspaces } = useQuery({
    queryKey: ["admin-top-workspaces"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_top_workspaces_usage", {
        p_days: 7,
        p_limit: 10,
      });
      
      if (error) throw error;
      return data as TopWorkspace[];
    },
    enabled: isPlatformAdmin === true,
  });

  // Fetch global account usage
  const { data: globalAccountUsage, isLoading: isLoadingGlobalUsage } = useQuery({
    queryKey: ["admin-global-account-usage"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_global_account_usage", {
        p_days: 7,
      });
      
      if (error) throw error;
      return data as GlobalAccountUsage[];
    },
    enabled: isPlatformAdmin === true,
  });

  // Update plan mutation
  const updatePlanMutation = useMutation({
    mutationFn: async (plan: Partial<Plan> & { id: string }) => {
      const { id, ...updates } = plan;
      const { error } = await supabase
        .from("plans")
        .update(updates)
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-plans"] });
      queryClient.invalidateQueries({ queryKey: ["plans"] });
    },
  });

  // Create plan mutation
  const createPlanMutation = useMutation({
    mutationFn: async (plan: Omit<Plan, 'id' | 'created_at' | 'updated_at'>) => {
      const { error } = await supabase
        .from("plans")
        .insert(plan);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-plans"] });
      queryClient.invalidateQueries({ queryKey: ["plans"] });
    },
  });

  // Assign plan to workspace mutation
  const assignPlanMutation = useMutation({
    mutationFn: async ({ workspaceId, planId }: { workspaceId: string; planId: string }) => {
      // Upsert workspace_plan
      const { error } = await supabase
        .from("workspace_plans")
        .upsert({
          workspace_id: workspaceId,
          plan_id: planId,
          status: 'active',
          starts_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'workspace_id',
        });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-workspaces-plans"] });
      queryClient.invalidateQueries({ queryKey: ["workspace-plan"] });
    },
  });

  return {
    plans,
    workspaces,
    usageOverview,
    topWorkspaces,
    globalAccountUsage,
    isLoading: isLoadingPlans || isLoadingWorkspaces || isLoadingUsageOverview || isLoadingTopWorkspaces || isLoadingGlobalUsage,
    updatePlan: updatePlanMutation.mutateAsync,
    isUpdatingPlan: updatePlanMutation.isPending,
    createPlan: createPlanMutation.mutateAsync,
    isCreatingPlan: createPlanMutation.isPending,
    assignPlan: assignPlanMutation.mutateAsync,
    isAssigningPlan: assignPlanMutation.isPending,
  };
}
