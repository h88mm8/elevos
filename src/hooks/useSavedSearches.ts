import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

export interface SavedSearch {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  api: string;
  filters_json: Record<string, any>;
  is_shared: boolean;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

interface UseSavedSearchesOptions {
  workspaceId: string | undefined;
}

export function useSavedSearches({ workspaceId }: UseSavedSearchesOptions) {
  const { toast } = useToast();
  const { user } = useAuth();
  
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const fetchSearches = useCallback(async () => {
    if (!workspaceId) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('linkedin_saved_searches')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setSearches((data as unknown as SavedSearch[]) || []);
    } catch (err: any) {
      console.error('[useSavedSearches] Error fetching:', err);
      toast({
        title: 'Erro ao carregar pesquisas salvas',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, toast]);

  const saveSearch = useCallback(async (
    name: string,
    filters: Record<string, any>,
    api: string = 'classic',
    isShared: boolean = false
  ) => {
    if (!workspaceId || !user) return null;

    setIsSaving(true);
    try {
      const { data, error } = await supabase
        .from('linkedin_saved_searches')
        .insert({
          workspace_id: workspaceId,
          user_id: user.id,
          name,
          api,
          filters_json: filters,
          is_shared: isShared,
        } as any)
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Pesquisa salva',
        description: `"${name}" foi salva com sucesso.`,
      });

      await fetchSearches();
      return data as unknown as SavedSearch;
    } catch (err: any) {
      console.error('[useSavedSearches] Error saving:', err);
      toast({
        title: 'Erro ao salvar pesquisa',
        description: err.message,
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [workspaceId, user, fetchSearches, toast]);

  const updateSearch = useCallback(async (
    id: string,
    updates: { name?: string; filters_json?: Record<string, any>; is_shared?: boolean }
  ) => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('linkedin_saved_searches')
        .update(updates as any)
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Pesquisa atualizada',
      });

      await fetchSearches();
    } catch (err: any) {
      console.error('[useSavedSearches] Error updating:', err);
      toast({
        title: 'Erro ao atualizar pesquisa',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  }, [fetchSearches, toast]);

  const deleteSearch = useCallback(async (id: string) => {
    try {
      const { error } = await supabase
        .from('linkedin_saved_searches')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Pesquisa excluída',
      });

      await fetchSearches();
    } catch (err: any) {
      console.error('[useSavedSearches] Error deleting:', err);
      toast({
        title: 'Erro ao excluir pesquisa',
        description: err.message,
        variant: 'destructive',
      });
    }
  }, [fetchSearches, toast]);

  const markAsRun = useCallback(async (id: string) => {
    try {
      await supabase
        .from('linkedin_saved_searches')
        .update({ last_run_at: new Date().toISOString() } as any)
        .eq('id', id);
    } catch (err) {
      console.error('[useSavedSearches] Error marking as run:', err);
    }
  }, []);

  useEffect(() => {
    fetchSearches();
  }, [fetchSearches]);

  return {
    searches,
    isLoading,
    isSaving,
    saveSearch,
    updateSearch,
    deleteSearch,
    markAsRun,
    refetch: fetchSearches,
  };
}
