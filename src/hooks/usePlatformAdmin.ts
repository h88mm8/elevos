import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface PlatformSettings {
  id: number;
  linkedin_search_account_id: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface LinkedInAccountWithWorkspace {
  id: string;
  account_id: string;
  name: string | null;
  linkedin_feature: string | null;
  workspace_id: string;
  workspace_name: string;
}

export function usePlatformAdmin() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Check if current user is platform admin
  const { data: isPlatformAdmin, isLoading: isCheckingAdmin, refetch: refetchAdminStatus } = useQuery({
    queryKey: ["platform-admin-check", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      
      const { data, error } = await supabase
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      
      if (error) {
        console.error("Error checking platform admin status:", error);
        return false;
      }
      
      return !!data;
    },
    enabled: !!user?.id,
  });

  // Check if any admins exist (for bootstrap)
  const { data: hasAnyAdmin, isLoading: isCheckingAnyAdmin } = useQuery({
    queryKey: ["platform-has-any-admin"],
    queryFn: async () => {
      // We can't directly query platform_admins without being admin,
      // so we'll let the bootstrap endpoint handle this logic
      // This is a client-side approximation
      return isPlatformAdmin !== false; // Will be false if we know for sure user is not admin
    },
    enabled: isPlatformAdmin === false,
  });

  // Get platform settings (only if admin)
  const { data: platformSettings, isLoading: isLoadingSettings } = useQuery({
    queryKey: ["platform-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      
      if (error) {
        console.error("Error fetching platform settings:", error);
        throw error;
      }
      
      return data as PlatformSettings | null;
    },
    enabled: isPlatformAdmin === true,
  });

  // Get all connected LinkedIn accounts across all workspaces (for admin selection)
  const { data: linkedInAccounts, isLoading: isLoadingAccounts } = useQuery({
    queryKey: ["all-linkedin-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-all-linkedin-accounts");
      
      if (error) {
        console.error("Error fetching all LinkedIn accounts:", error);
        throw error;
      }
      
      return data.accounts as LinkedInAccountWithWorkspace[];
    },
    enabled: isPlatformAdmin === true,
  });

  // Bootstrap mutation - become first admin
  const bootstrapMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("platform-admin-bootstrap");
      
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-admin-check"] });
      queryClient.invalidateQueries({ queryKey: ["platform-has-any-admin"] });
    },
  });

  // Update platform settings via edge function
  const updateSettingsMutation = useMutation({
    mutationFn: async (linkedinSearchAccountId: string | null) => {
      const { data, error } = await supabase.functions.invoke("update-platform-settings", {
        body: { linkedin_search_account_id: linkedinSearchAccountId }
      });
      
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-settings"] });
    },
  });

  return {
    isPlatformAdmin,
    isCheckingAdmin,
    hasAnyAdmin,
    isCheckingAnyAdmin,
    platformSettings,
    isLoadingSettings,
    linkedInAccounts,
    isLoadingAccounts,
    updateSettings: updateSettingsMutation.mutateAsync,
    isUpdating: updateSettingsMutation.isPending,
    bootstrap: bootstrapMutation.mutateAsync,
    isBootstrapping: bootstrapMutation.isPending,
    refetchAdminStatus,
  };
}
