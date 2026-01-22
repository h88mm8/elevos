import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface PlatformSettings {
  id: number;
  linkedin_search_account_id: string | null;
  updated_at: string;
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
  const { data: isPlatformAdmin, isLoading: isCheckingAdmin } = useQuery({
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
      // Use service role through edge function to get all accounts
      const { data, error } = await supabase.functions.invoke("get-all-linkedin-accounts");
      
      if (error) {
        console.error("Error fetching all LinkedIn accounts:", error);
        throw error;
      }
      
      return data.accounts as LinkedInAccountWithWorkspace[];
    },
    enabled: isPlatformAdmin === true,
  });

  // Update platform settings
  const updateSettingsMutation = useMutation({
    mutationFn: async (linkedinSearchAccountId: string | null) => {
      const { data, error } = await supabase
        .from("platform_settings")
        .update({ 
          linkedin_search_account_id: linkedinSearchAccountId,
          updated_at: new Date().toISOString()
        })
        .eq("id", 1)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-settings"] });
    },
  });

  return {
    isPlatformAdmin,
    isCheckingAdmin,
    platformSettings,
    isLoadingSettings,
    linkedInAccounts,
    isLoadingAccounts,
    updateSettings: updateSettingsMutation.mutateAsync,
    isUpdating: updateSettingsMutation.isPending,
  };
}
