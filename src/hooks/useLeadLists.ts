import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { LeadList } from '@/types';

export function useLeadLists() {
  const { currentWorkspace } = useAuth();
  const queryClient = useQueryClient();

  const listsQuery = useQuery({
    queryKey: ['lead-lists', currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace) return [];
      const { data, error } = await supabase
        .from('lead_lists')
        .select('*')
        .eq('workspace_id', currentWorkspace.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as LeadList[];
    },
    enabled: !!currentWorkspace,
  });

  const createListMutation = useMutation({
    mutationFn: async (list: { name: string; description?: string }) => {
      if (!currentWorkspace) throw new Error('No workspace selected');
      const { data, error } = await supabase
        .from('lead_lists')
        .insert({
          workspace_id: currentWorkspace.id,
          name: list.name,
          description: list.description || null,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data as LeadList;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-lists', currentWorkspace?.id] });
    },
  });

  const updateListMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<LeadList> & { id: string }) => {
      const { data, error } = await supabase
        .from('lead_lists')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data as LeadList;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-lists', currentWorkspace?.id] });
    },
  });

  const deleteListMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('lead_lists')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-lists', currentWorkspace?.id] });
    },
  });

  return {
    lists: listsQuery.data ?? [],
    isLoading: listsQuery.isLoading,
    isError: listsQuery.isError,
    createList: createListMutation.mutateAsync,
    updateList: updateListMutation.mutateAsync,
    deleteList: deleteListMutation.mutateAsync,
    refetchLists: () => queryClient.invalidateQueries({ queryKey: ['lead-lists', currentWorkspace?.id] }),
  };
}
