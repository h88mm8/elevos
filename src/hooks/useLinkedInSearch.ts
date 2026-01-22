import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface LinkedInSearchResult {
  provider_id: string;
  public_identifier: string;
  first_name: string;
  last_name: string;
  full_name: string;
  headline?: string;
  profile_url: string;
  profile_picture_url?: string;
  location?: string;
  connection_degree?: number;
  company?: string;
  job_title?: string;
}

export interface LinkedInSearchFilters {
  keywords: string;
  title: string;
  company: string;
  location: string;
}

interface UseLinkedInSearchOptions {
  workspaceId: string | undefined;
}

export function useLinkedInSearch({ workspaceId }: UseLinkedInSearchOptions) {
  const { toast } = useToast();
  
  const [results, setResults] = useState<LinkedInSearchResult[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (
    filters: LinkedInSearchFilters,
    newCursor?: string
  ) => {
    if (!workspaceId) {
      setError('Workspace não selecionado');
      return;
    }

    const isNewSearch = !newCursor;
    setIsSearching(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('linkedin-search', {
        body: {
          workspaceId,
          searchType: 'people',
          api: 'classic',
          filters: {
            keywords: filters.keywords.trim() || undefined,
            title: filters.title.trim() || undefined,
            company: filters.company.trim() || undefined,
            location: filters.location.trim() || undefined,
          },
          limit: 25,
          cursor: newCursor,
        },
      });

      if (fnError) throw fnError;
      if (data.error) throw new Error(data.error);

      const newResults = data.results || [];
      
      if (isNewSearch) {
        setResults(newResults);
      } else {
        // For pagination, replace results (not append - we show one page at a time)
        setResults(newResults);
      }

      setCursor(data.cursor || null);
      setHasMore(!!data.cursor && newResults.length > 0);

      if (newResults.length === 0 && isNewSearch) {
        toast({
          title: 'Nenhum resultado',
          description: 'Tente ajustar os filtros da busca.',
        });
      }
    } catch (err: any) {
      const errorMsg = err.message || '';
      
      // Check if global account not configured
      if (errorMsg.includes('global') || errorMsg.includes('configurada') || errorMsg.includes('not configured')) {
        setError('Busca LinkedIn indisponível. Peça ao administrador para configurar a conta global do LinkedIn.');
        toast({
          title: 'Busca LinkedIn indisponível',
          description: 'Peça ao administrador para configurar a conta global do LinkedIn.',
          variant: 'destructive',
        });
      } else {
        setError(errorMsg || 'Não foi possível buscar no LinkedIn');
        toast({
          title: 'Erro na busca',
          description: errorMsg || 'Não foi possível buscar no LinkedIn',
          variant: 'destructive',
        });
      }
    } finally {
      setIsSearching(false);
    }
  }, [workspaceId, toast]);

  const clearResults = useCallback(() => {
    setResults([]);
    setCursor(null);
    setHasMore(false);
    setError(null);
  }, []);

  return {
    results,
    cursor,
    isSearching,
    hasMore,
    error,
    search,
    clearResults,
  };
}
