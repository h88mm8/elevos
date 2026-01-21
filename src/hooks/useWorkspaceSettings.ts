import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface WorkspaceSettings {
  id: string;
  workspace_id: string;
  // WhatsApp settings
  daily_message_limit: number;
  message_interval_seconds: number;
  max_retries: number;
  // LinkedIn settings
  linkedin_daily_message_limit: number;
  linkedin_daily_invite_limit: number;
  linkedin_message_interval_seconds: number;
  created_at: string;
  updated_at: string;
}

const DEFAULT_SETTINGS = {
  // WhatsApp defaults
  daily_message_limit: 50,
  message_interval_seconds: 15,
  max_retries: 3,
  // LinkedIn defaults
  linkedin_daily_message_limit: 50,
  linkedin_daily_invite_limit: 25,
  linkedin_message_interval_seconds: 30,
};

export function useWorkspaceSettings() {
  const { currentWorkspace } = useAuth();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ['workspace-settings', currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace) return null;
      
      const { data, error } = await supabase
        .from('workspace_settings')
        .select('*')
        .eq('workspace_id', currentWorkspace.id)
        .maybeSingle();
      
      if (error) throw error;
      return data as WorkspaceSettings | null;
    },
    enabled: !!currentWorkspace,
  });

  const upsertSettingsMutation = useMutation({
    mutationFn: async (settings: Partial<Pick<WorkspaceSettings, 'daily_message_limit' | 'message_interval_seconds' | 'max_retries' | 'linkedin_daily_message_limit' | 'linkedin_daily_invite_limit' | 'linkedin_message_interval_seconds'>>) => {
      if (!currentWorkspace) throw new Error('No workspace selected');

      // Check if settings exist
      const { data: existing } = await supabase
        .from('workspace_settings')
        .select('id')
        .eq('workspace_id', currentWorkspace.id)
        .maybeSingle();

      if (existing) {
        // Update existing
        const { data, error } = await supabase
          .from('workspace_settings')
          .update(settings)
          .eq('workspace_id', currentWorkspace.id)
          .select()
          .single();
        
        if (error) throw error;
        return data;
      } else {
        // Insert new
        const { data, error } = await supabase
          .from('workspace_settings')
          .insert({
            workspace_id: currentWorkspace.id,
            ...DEFAULT_SETTINGS,
            ...settings,
          })
          .select()
          .single();
        
        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-settings', currentWorkspace?.id] });
    },
  });

  return {
    settings: settingsQuery.data ?? {
      ...DEFAULT_SETTINGS,
      workspace_id: currentWorkspace?.id ?? '',
    },
    isLoading: settingsQuery.isLoading,
    isError: settingsQuery.isError,
    updateSettings: upsertSettingsMutation.mutateAsync,
    isUpdating: upsertSettingsMutation.isPending,
  };
}
