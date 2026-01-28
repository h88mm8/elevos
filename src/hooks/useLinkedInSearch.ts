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
  // Enriched fields (from Unipile auto-enrichment)
  industry?: string;
  seniority_level?: string;
  city?: string;
  state?: string;
  country?: string;
  email?: string;
  personal_email?: string;
  phone?: string;
  mobile_number?: string;
  company_linkedin?: string;
  keywords?: string;
  about?: string;
  connections?: number;
  followers?: number;
}

export interface LinkedInSearchFilters {
  keywords: string;
  title: string;
  company: string;
  location: string;
  // Advanced filters with IDs for autocomplete
  locationIds: AutocompleteOption[];
  countryIds: AutocompleteOption[];
  stateIds: AutocompleteOption[];
  cityIds: AutocompleteOption[];
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
  countryIds: [],
  stateIds: [],
  cityIds: [],
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

export interface QuotaBlockedInfo {
  action: string;
  usage: SearchUsage;
  plan: {
    code: string;
    name: string;
  };
}

export function useLinkedInSearch({ workspaceId }: UseLinkedInSearchOptions) {
  const { toast } = useToast();
  
  const [results, setResults] = useState<LinkedInSearchResult[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<SearchUsage | null>(null);
  const [quotaBlocked, setQuotaBlocked] = useState<QuotaBlockedInfo | null>(null);

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
    // Don't clear quotaBlocked here to preserve banner visibility

    try {
      // Build filters payload - prefer IDs when available, fallback to text
      const filtersPayload: Record<string, unknown> = {};
      
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
      
      // Location: combine all location IDs (country, state, city, general)
      const allLocationIds = [
        ...filters.countryIds.map(l => l.id),
        ...filters.stateIds.map(l => l.id),
        ...filters.cityIds.map(l => l.id),
        ...filters.locationIds.map(l => l.id),
      ];
      
      if (allLocationIds.length > 0) {
        filtersPayload.location_ids = allLocationIds;
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

      // Check for 429 limit reached
      if (fnError) {
        // The error object from supabase functions might have context
        throw fnError;
      }
      
      // Check if response has error field (429 or other API errors)
      if (data?.error) {
        // Handle 429 quota limit
        if (data.error === 'Daily limit reached' && data.usage && data.plan) {
          const blocked: QuotaBlockedInfo = {
            action: data.action || 'linkedin_search_page',
            usage: data.usage,
            plan: data.plan,
          };
          setQuotaBlocked(blocked);
          
          toast({
            title: 'Limite diário atingido',
            description: `Você usou ${data.usage.current}/${data.usage.limit} buscas hoje no plano ${data.plan.name}.`,
            variant: 'destructive',
          });
          
          setError(`Limite diário atingido (${data.usage.current}/${data.usage.limit})`);
          return;
        }
        
        // Handle quota system unavailable
        if (data.error === 'Quota system unavailable') {
          setError('Sistema de quotas indisponível. Tente novamente mais tarde.');
          toast({
            title: 'Sistema indisponível',
            description: 'Não foi possível verificar os limites de uso. Tente novamente.',
            variant: 'destructive',
          });
          return;
        }
        
        throw new Error(data.error);
      }

      // Clear quota blocked on success
      setQuotaBlocked(null);
      
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
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      
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
    setQuotaBlocked(null);
  }, []);

  return {
    results,
    cursor,
    isSearching,
    hasMore,
    error,
    usage,
    quotaBlocked,
    search,
    clearResults,
  };
}
