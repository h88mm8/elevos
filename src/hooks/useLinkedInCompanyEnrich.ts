/**
 * Hook for on-demand LinkedIn company enrichment with cache
 * Triggered when user selects a lead or opens details
 */

import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface CompanyData {
  name: string | null;
  description: string | null;
  industry: string | null;
  company_size: string | null;
  employee_count: number | null;
  employee_count_range: string | null;
  founded_year: number | null;
  website: string | null;
  linkedin_url: string | null;
  headquarters: string | null;
  specialties: string[] | null;
  logo_url: string | null;
}

interface CompanyEnrichStatus {
  status: 'pending' | 'loading' | 'success' | 'error';
  errorReason?: string;
}

interface UseLinkedInCompanyEnrichOptions {
  workspaceId: string | undefined;
  maxConcurrency?: number;
}

export function useLinkedInCompanyEnrich({
  workspaceId,
  maxConcurrency = 2,
}: UseLinkedInCompanyEnrichOptions) {
  // Cache: companyIdentifier -> CompanyData
  const [companyCache, setCompanyCache] = useState<Map<string, CompanyData>>(new Map());
  
  // Status per company
  const [statusMap, setStatusMap] = useState<Map<string, CompanyEnrichStatus>>(new Map());
  
  // Concurrency control
  const activeRef = useRef<number>(0);
  const queueRef = useRef<string[]>([]);
  const inFlightRef = useRef<Set<string>>(new Set());

  // Process queue with concurrency limit
  const processQueue = useCallback(async () => {
    if (!workspaceId) return;

    while (queueRef.current.length > 0 && activeRef.current < maxConcurrency) {
      const companyId = queueRef.current.shift();
      if (!companyId) continue;
      
      // Skip if already in flight or cached
      if (inFlightRef.current.has(companyId)) continue;
      if (companyCache.has(companyId)) continue;
      
      inFlightRef.current.add(companyId);
      activeRef.current++;

      // Update status to loading
      setStatusMap(prev => {
        const next = new Map(prev);
        next.set(companyId, { status: 'loading' });
        return next;
      });

      try {
        const { data, error } = await supabase.functions.invoke('linkedin-company-enrich', {
          body: { workspaceId, companyIdentifier: companyId },
        });

        if (error) throw error;

        if (data.status === 'error') {
          setStatusMap(prev => {
            const next = new Map(prev);
            next.set(companyId, { status: 'error', errorReason: data.error_reason });
            return next;
          });
        } else {
          // Store in cache
          const companyData: CompanyData = {
            name: data.name,
            description: data.description,
            industry: data.industry,
            company_size: data.company_size,
            employee_count: data.employee_count,
            employee_count_range: data.employee_count_range,
            founded_year: data.founded_year,
            website: data.website,
            linkedin_url: data.linkedin_url,
            headquarters: data.headquarters,
            specialties: data.specialties,
            logo_url: data.logo_url,
          };

          setCompanyCache(prev => {
            const next = new Map(prev);
            next.set(companyId, companyData);
            return next;
          });

          setStatusMap(prev => {
            const next = new Map(prev);
            next.set(companyId, { status: 'success' });
            return next;
          });
        }
      } catch (err) {
        setStatusMap(prev => {
          const next = new Map(prev);
          next.set(companyId, { status: 'error', errorReason: 'network_error' });
          return next;
        });
      } finally {
        activeRef.current--;
        inFlightRef.current.delete(companyId);
        // Continue processing queue
        processQueue();
      }
    }
  }, [workspaceId, maxConcurrency, companyCache]);

  // Request company enrichment (on-demand)
  const enrichCompany = useCallback((companyIdentifier: string | null | undefined) => {
    if (!companyIdentifier || !workspaceId) return;
    
    // Already cached or in queue/flight
    if (companyCache.has(companyIdentifier)) return;
    if (inFlightRef.current.has(companyIdentifier)) return;
    if (queueRef.current.includes(companyIdentifier)) return;
    
    // Add to queue
    queueRef.current.push(companyIdentifier);
    setStatusMap(prev => {
      const next = new Map(prev);
      next.set(companyIdentifier, { status: 'pending' });
      return next;
    });
    
    processQueue();
  }, [workspaceId, processQueue, companyCache]);

  // Get cached company data
  const getCompanyData = useCallback((companyIdentifier: string | null | undefined): CompanyData | undefined => {
    if (!companyIdentifier) return undefined;
    return companyCache.get(companyIdentifier);
  }, [companyCache]);

  // Get company status
  const getCompanyStatus = useCallback((companyIdentifier: string | null | undefined): CompanyEnrichStatus | undefined => {
    if (!companyIdentifier) return undefined;
    return statusMap.get(companyIdentifier);
  }, [statusMap]);

  // Check if company is enriched
  const isCompanyEnriched = useCallback((companyIdentifier: string | null | undefined): boolean => {
    if (!companyIdentifier) return false;
    return companyCache.has(companyIdentifier);
  }, [companyCache]);

  // Reset cache
  const reset = useCallback(() => {
    setCompanyCache(new Map());
    setStatusMap(new Map());
    queueRef.current = [];
    inFlightRef.current.clear();
    activeRef.current = 0;
  }, []);

  return {
    enrichCompany,
    getCompanyData,
    getCompanyStatus,
    isCompanyEnriched,
    reset,
    companyCache,
    statusMap,
  };
}
