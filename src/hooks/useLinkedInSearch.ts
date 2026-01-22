import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { AutocompleteOption } from '@/hooks/useLinkedInAutocomplete';

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
  // Advanced filters with IDs for autocomplete
  locationIds: AutocompleteOption[];
  companyIds: AutocompleteOption[];
  industryIds: AutocompleteOption[];
  schoolIds: AutocompleteOption[];
  titleIds: AutocompleteOption[];
}

export const emptyFilters: LinkedInSearchFilters = {
  keywords: '',
  title: '',
  company: '',
  location: '',
  locationIds: [],
  companyIds: [],
  industryIds: [],
  schoolIds: [],
  titleIds: [],
};

interface UseLinkedInSearchOptions {
  workspaceId: string | undefined;
}

export interface SearchUsage {
  current: number;
  limit: number;
}

export function useLinkedInSearch({ workspaceId }: UseLinkedInSearchOptions) {
  const { toast } = useToast();
  
  const [results, setResults] = useState<LinkedInSearchResult[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<SearchUsage | null>(null);

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
      // Build filters payload - prefer IDs when available, fallback to text
      const filtersPayload: Record<string, any> = {};
      
      if (filters.keywords.trim()) {
        filtersPayload.keywords = filters.keywords.trim();
      }
      
      // Title: prefer titleIds, fallback to text
      if (filters.titleIds.length > 0) {
        filtersPayload.title_ids = filters.titleIds.map(t => t.id);
      } else if (filters.title.trim()) {
        filtersPayload.title = filters.title.trim();
      }
      
      // Company: prefer companyIds, fallback to text
      if (filters.companyIds.length > 0) {
        filtersPayload.company_ids = filters.companyIds.map(c => c.id);
      } else if (filters.company.trim()) {
        filtersPayload.company = filters.company.trim();
      }
      
      // Location: prefer locationIds, fallback to text
      if (filters.locationIds.length > 0) {
        filtersPayload.location_ids = filters.locationIds.map(l => l.id);
      } else if (filters.location.trim()) {
        filtersPayload.location = filters.location.trim();
      }
      
      // Industry IDs only (no text fallback)
      if (filters.industryIds.length > 0) {
        filtersPayload.industry_ids = filters.industryIds.map(i => i.id);
      }
      
      // School IDs only (no text fallback)
      if (filters.schoolIds.length > 0) {
        filtersPayload.school_ids = filters.schoolIds.map(s => s.id);
      }

      const { data, error: fnError } = await supabase.functions.invoke('linkedin-search', {
        body: {
          workspaceId,
          searchType: 'people',
          api: 'classic',
          filters: filtersPayload,
          limit: 25,
          cursor: newCursor,
        },
      });

      if (fnError) throw fnError;
      if (data.error) throw new Error(data.error);

      const newResults = data.results || [];
      setResults(newResults);
      setCursor(data.cursor || null);
      setHasMore(!!data.cursor && newResults.length > 0);
      
      if (data.usage) {
        setUsage(data.usage);
      }

      if (newResults.length === 0 && isNewSearch) {
        toast({
          title: 'Nenhum resultado',
          description: 'Tente ajustar os filtros da busca.',
        });
      }
    } catch (err: any) {
      const errorMsg = err.message || '';
      
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
    setUsage(null);
  }, []);

  return {
    results,
    cursor,
    isSearching,
    hasMore,
    error,
    usage,
    search,
    clearResults,
  };
}
