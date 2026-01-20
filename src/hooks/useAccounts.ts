import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface Account {
  id: string;
  workspace_id: string;
  provider: string;
  channel: string;
  account_id: string;
  name: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export function useAccounts(channel?: string) {
  const { currentWorkspace } = useAuth();
  const queryClient = useQueryClient();

  const accountsQuery = useQuery({
    queryKey: ['accounts', currentWorkspace?.id, channel],
    queryFn: async () => {
      if (!currentWorkspace) return [];
      
      const { data, error } = await supabase.functions.invoke('get-accounts', {
        body: { 
          workspaceId: currentWorkspace.id,
          channel,
        },
      });
      
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      
      return data.accounts as Account[];
    },
    enabled: !!currentWorkspace,
  });

  const syncAccountsMutation = useMutation({
    mutationFn: async () => {
      if (!currentWorkspace) throw new Error('No workspace selected');
      
      const { data, error } = await supabase.functions.invoke('sync-accounts', {
        body: { workspaceId: currentWorkspace.id },
      });
      
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts', currentWorkspace?.id] });
    },
  });

  return {
    accounts: accountsQuery.data ?? [],
    isLoading: accountsQuery.isLoading,
    isError: accountsQuery.isError,
    error: accountsQuery.error,
    syncAccounts: syncAccountsMutation.mutateAsync,
    isSyncing: syncAccountsMutation.isPending,
    refetchAccounts: () => queryClient.invalidateQueries({ queryKey: ['accounts', currentWorkspace?.id] }),
  };
}
