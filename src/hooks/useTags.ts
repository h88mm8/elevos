import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface Tag {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface LeadTag {
  id: string;
  lead_id: string;
  tag_id: string;
  created_at: string;
}

export function useTags() {
  const { currentWorkspace } = useAuth();
  const queryClient = useQueryClient();

  // Fetch all tags for workspace
  const tagsQuery = useQuery({
    queryKey: ['tags', currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace) return [];
      const { data, error } = await supabase
        .from('tags')
        .select('*')
        .eq('workspace_id', currentWorkspace.id)
        .order('name');
      
      if (error) throw error;
      return data as Tag[];
    },
    enabled: !!currentWorkspace,
  });

  // Fetch all lead_tags for workspace leads
  const leadTagsQuery = useQuery({
    queryKey: ['lead_tags', currentWorkspace?.id],
    queryFn: async () => {
      if (!currentWorkspace) return [];
      const { data, error } = await supabase
        .from('lead_tags')
        .select(`
          id,
          lead_id,
          tag_id,
          created_at
        `);
      
      if (error) throw error;
      return data as LeadTag[];
    },
    enabled: !!currentWorkspace,
  });

  // Create tag
  const createTagMutation = useMutation({
    mutationFn: async ({ name, color }: { name: string; color: string }) => {
      if (!currentWorkspace) throw new Error('No workspace');
      const { data, error } = await supabase
        .from('tags')
        .insert({ workspace_id: currentWorkspace.id, name, color })
        .select()
        .single();
      
      if (error) throw error;
      return data as Tag;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags', currentWorkspace?.id] });
    },
  });

  // Update tag
  const updateTagMutation = useMutation({
    mutationFn: async ({ id, name, color }: { id: string; name?: string; color?: string }) => {
      const updates: Record<string, string> = {};
      if (name) updates.name = name;
      if (color) updates.color = color;

      const { data, error } = await supabase
        .from('tags')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data as Tag;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags', currentWorkspace?.id] });
    },
  });

  // Delete tag
  const deleteTagMutation = useMutation({
    mutationFn: async (tagId: string) => {
      const { error } = await supabase
        .from('tags')
        .delete()
        .eq('id', tagId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags', currentWorkspace?.id] });
      queryClient.invalidateQueries({ queryKey: ['lead_tags', currentWorkspace?.id] });
    },
  });

  // Add tag to lead
  const addTagToLeadMutation = useMutation({
    mutationFn: async ({ leadId, tagId }: { leadId: string; tagId: string }) => {
      const { data, error } = await supabase
        .from('lead_tags')
        .insert({ lead_id: leadId, tag_id: tagId })
        .select()
        .single();
      
      if (error) {
        if (error.code === '23505') return null; // Duplicate, ignore
        throw error;
      }
      return data as LeadTag;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead_tags', currentWorkspace?.id] });
    },
  });

  // Remove tag from lead
  const removeTagFromLeadMutation = useMutation({
    mutationFn: async ({ leadId, tagId }: { leadId: string; tagId: string }) => {
      const { error } = await supabase
        .from('lead_tags')
        .delete()
        .eq('lead_id', leadId)
        .eq('tag_id', tagId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead_tags', currentWorkspace?.id] });
    },
  });

  // Helper: get tags for a specific lead
  const getLeadTags = (leadId: string): Tag[] => {
    const leadTagIds = leadTagsQuery.data?.filter(lt => lt.lead_id === leadId).map(lt => lt.tag_id) || [];
    return tagsQuery.data?.filter(t => leadTagIds.includes(t.id)) || [];
  };

  return {
    tags: tagsQuery.data ?? [],
    leadTags: leadTagsQuery.data ?? [],
    isLoading: tagsQuery.isLoading || leadTagsQuery.isLoading,
    createTag: createTagMutation.mutateAsync,
    updateTag: updateTagMutation.mutateAsync,
    deleteTag: deleteTagMutation.mutateAsync,
    addTagToLead: addTagToLeadMutation.mutateAsync,
    removeTagFromLead: removeTagFromLeadMutation.mutateAsync,
    getLeadTags,
    refetchTags: () => {
      queryClient.invalidateQueries({ queryKey: ['tags', currentWorkspace?.id] });
      queryClient.invalidateQueries({ queryKey: ['lead_tags', currentWorkspace?.id] });
    },
  };
}
