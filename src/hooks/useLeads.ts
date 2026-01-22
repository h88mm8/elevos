import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Lead } from '@/types';

export function useLeads() {
  const { currentWorkspace } = useAuth();
  const queryClient = useQueryClient();

  const leadsQuery = useQuery({
    queryKey: ['leads', currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace) return [];
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('workspace_id', currentWorkspace.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as Lead[];
    },
    enabled: !!currentWorkspace,
  });

  const createLeadMutation = useMutation({
    mutationFn: async (lead: Omit<Lead, 'id' | 'created_at' | 'updated_at'>) => {
      // Cast to any to handle type mismatches with Supabase generated types
      const { data, error } = await supabase
        .from('leads')
        .insert(lead as any)
        .select()
        .single();
      
      if (error) throw error;
      return data as Lead;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads', currentWorkspace?.id] });
    },
  });

  const updateLeadMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Lead> & { id: string }) => {
      // Cast to any to handle type mismatches with Supabase generated types
      const { data, error } = await supabase
        .from('leads')
        .update(updates as any)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data as Lead;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads', currentWorkspace?.id] });
    },
  });

  const deleteLeadsMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('leads')
        .delete()
        .in('id', ids);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads', currentWorkspace?.id] });
    },
  });

  const moveLeadsMutation = useMutation({
    mutationFn: async ({ leadIds, listId }: { leadIds: string[]; listId: string | null }) => {
      const { error } = await supabase
        .from('leads')
        .update({ list_id: listId })
        .in('id', leadIds);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads', currentWorkspace?.id] });
    },
  });

  return {
    leads: leadsQuery.data ?? [],
    isLoading: leadsQuery.isLoading,
    isError: leadsQuery.isError,
    createLead: createLeadMutation.mutateAsync,
    updateLead: updateLeadMutation.mutateAsync,
    deleteLeads: deleteLeadsMutation.mutateAsync,
    moveLeads: moveLeadsMutation.mutateAsync,
    refetchLeads: () => queryClient.invalidateQueries({ queryKey: ['leads', currentWorkspace?.id] }),
  };
}
