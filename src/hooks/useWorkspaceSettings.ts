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

      // Validate and clamp values to safe ranges
      const validatedSettings: typeof settings = {};
      
      if (settings.daily_message_limit !== undefined) {
        validatedSettings.daily_message_limit = Math.max(1, Math.min(500, settings.daily_message_limit));
      }
      if (settings.message_interval_seconds !== undefined) {
        validatedSettings.message_interval_seconds = Math.max(10, Math.min(120, settings.message_interval_seconds));
      }
      if (settings.max_retries !== undefined) {
        validatedSettings.max_retries = Math.max(0, Math.min(10, settings.max_retries));
      }
      if (settings.linkedin_daily_message_limit !== undefined) {
        validatedSettings.linkedin_daily_message_limit = Math.max(1, Math.min(100, settings.linkedin_daily_message_limit));
      }
      if (settings.linkedin_daily_invite_limit !== undefined) {
        validatedSettings.linkedin_daily_invite_limit = Math.max(1, Math.min(50, settings.linkedin_daily_invite_limit));
      }
      if (settings.linkedin_message_interval_seconds !== undefined) {
        validatedSettings.linkedin_message_interval_seconds = Math.max(10, Math.min(300, settings.linkedin_message_interval_seconds));
      }

      // Skip update if no changes
      if (Object.keys(validatedSettings).length === 0) {
        const { data: current } = await supabase
          .from('workspace_settings')
          .select('*')
          .eq('workspace_id', currentWorkspace.id)
          .maybeSingle();
        return current;
      }

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
          .update(validatedSettings)
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
            ...validatedSettings,
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
