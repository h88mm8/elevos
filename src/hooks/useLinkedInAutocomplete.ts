import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface AutocompleteOption {
  id: string;
  name: string;
}

type ParameterType = 'location' | 'industry' | 'company' | 'school' | 'title';

interface UseLinkedInAutocompleteOptions {
  workspaceId: string | undefined;
  type: ParameterType;
  debounceMs?: number;
}

export function useLinkedInAutocomplete({ 
  workspaceId, 
  type,
  debounceMs = 300 
}: UseLinkedInAutocompleteOptions) {
  const [options, setOptions] = useState<AutocompleteOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (query: string) => {
    if (!workspaceId) {
      setError('Workspace não selecionado');
      return;
    }

    if (!query || query.length < 2) {
      setOptions([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        'linkedin-search-parameters',
        {
          body: null,
          headers: {},
        }
      );

      // We need to use GET with query params, so use fetch directly
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      
      if (!token) {
        throw new Error('Not authenticated');
      }

      const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/linkedin-search-parameters`);
      url.searchParams.set('workspaceId', workspaceId);
      url.searchParams.set('type', type);
      url.searchParams.set('query', query);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch options');
      }

      const result = await response.json();
      setOptions(result.items || []);
    } catch (err: any) {
      console.error('[useLinkedInAutocomplete] Error:', err);
      setError(err.message || 'Erro ao buscar opções');
      setOptions([]);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, type]);

  const clearOptions = useCallback(() => {
    setOptions([]);
    setError(null);
  }, []);

  return {
    options,
    isLoading,
    error,
    search,
    clearOptions,
  };
}
