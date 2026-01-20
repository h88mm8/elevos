import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Credits, CreditHistory } from '@/types';

export function useCredits() {
  const { currentWorkspace } = useAuth();
  const queryClient = useQueryClient();

  const creditsQuery = useQuery({
    queryKey: ['credits', currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace) return null;
      const { data, error } = await supabase
        .from('credits')
        .select('*')
        .eq('workspace_id', currentWorkspace.id)
        .maybeSingle();
      
      if (error) throw error;
      return data as Credits | null;
    },
    enabled: !!currentWorkspace,
  });

  const creditHistoryQuery = useQuery({
    queryKey: ['credit_history', currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace) return [];
      const { data, error } = await supabase
        .from('credit_history')
        .select('*')
        .eq('workspace_id', currentWorkspace.id)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data as CreditHistory[];
    },
    enabled: !!currentWorkspace,
  });

  const refetchCredits = () => {
    queryClient.invalidateQueries({ queryKey: ['credits', currentWorkspace?.id] });
    queryClient.invalidateQueries({ queryKey: ['credit_history', currentWorkspace?.id] });
  };

  return {
    credits: creditsQuery.data,
    creditHistory: creditHistoryQuery.data ?? [],
    isLoading: creditsQuery.isLoading,
    isError: creditsQuery.isError,
    refetchCredits,
  };
}
