/**
 * Hook for progressive LinkedIn lead enrichment
 * Enriches visible leads in background with concurrency control
 */

import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInSearchResult } from './useLinkedInSearch';

export interface EnrichmentStatus {
  publicIdentifier: string;
  status: 'pending' | 'loading' | 'success' | 'error';
  errorReason?: string;
}

interface EnrichedData {
  headline?: string;
  job_title?: string;
  company?: string;
  company_linkedin?: string;
  company_identifier?: string; // For on-demand company enrichment
  industry?: string;
  seniority_level?: string;
  city?: string;
  state?: string;
  country?: string;
  email?: string;
  phone?: string;
  keywords?: string;
  about?: string;
  connections?: number;
  followers?: number;
  profile_picture_url?: string;
}

interface UseLinkedInEnrichPreviewOptions {
  workspaceId: string | undefined;
  concurrency?: number;
}

export function useLinkedInEnrichPreview({ 
  workspaceId, 
  concurrency = 3 
}: UseLinkedInEnrichPreviewOptions) {
  // Track enrichment status per lead
  const [statusMap, setStatusMap] = useState<Map<string, EnrichmentStatus>>(new Map());
  
  // Track enriched data per lead
  const [enrichedMap, setEnrichedMap] = useState<Map<string, EnrichedData>>(new Map());
  
  // Queue for pending enrichments
  const queueRef = useRef<string[]>([]);
  const activeRef = useRef<number>(0);
  const processedRef = useRef<Set<string>>(new Set());

  // Progress tracking
  const [progress, setProgress] = useState({ total: 0, completed: 0, failed: 0 });

  // Process queue with concurrency limit
  const processQueue = useCallback(async () => {
    if (!workspaceId) return;

    while (queueRef.current.length > 0 && activeRef.current < concurrency) {
      const publicIdentifier = queueRef.current.shift();
      if (!publicIdentifier) continue;
      
      // Skip if already processed or loading
      if (processedRef.current.has(publicIdentifier)) continue;
      processedRef.current.add(publicIdentifier);
      
      activeRef.current++;

      // Update status to loading
      setStatusMap(prev => {
        const next = new Map(prev);
        next.set(publicIdentifier, { publicIdentifier, status: 'loading' });
        return next;
      });

      try {
        const { data, error } = await supabase.functions.invoke('linkedin-enrich-preview', {
          body: { workspaceId, publicIdentifier },
        });

        if (error) throw error;

        if (data.status === 'error') {
          setStatusMap(prev => {
            const next = new Map(prev);
            next.set(publicIdentifier, { 
              publicIdentifier, 
              status: 'error', 
              errorReason: data.error_reason 
            });
            return next;
          });
          setProgress(prev => ({ ...prev, completed: prev.completed + 1, failed: prev.failed + 1 }));
        } else {
          // Store enriched data
          setEnrichedMap(prev => {
            const next = new Map(prev);
            next.set(publicIdentifier, {
              headline: data.headline,
              job_title: data.job_title,
              company: data.company,
              company_linkedin: data.company_linkedin,
              company_identifier: data.company_identifier,
              industry: data.industry,
              seniority_level: data.seniority_level,
              city: data.city,
              state: data.state,
              country: data.country,
              email: data.email,
              phone: data.phone,
              keywords: data.keywords,
              about: data.about,
              connections: data.connections,
              followers: data.followers,
              profile_picture_url: data.profile_picture_url,
            });
            return next;
          });

          setStatusMap(prev => {
            const next = new Map(prev);
            next.set(publicIdentifier, { publicIdentifier, status: 'success' });
            return next;
          });
          setProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
        }
      } catch (err) {
        setStatusMap(prev => {
          const next = new Map(prev);
          next.set(publicIdentifier, { 
            publicIdentifier, 
            status: 'error', 
            errorReason: 'network_error' 
          });
          return next;
        });
        setProgress(prev => ({ ...prev, completed: prev.completed + 1, failed: prev.failed + 1 }));
      } finally {
        activeRef.current--;
        // Continue processing queue
        processQueue();
      }
    }
  }, [workspaceId, concurrency]);

  // Enqueue leads for enrichment (only visible ones)
  const enrichLeads = useCallback((leads: LinkedInSearchResult[]) => {
    const newIdentifiers: string[] = [];
    
    for (const lead of leads) {
      const id = lead.public_identifier;
      if (!id) continue;
      
      // Skip if already queued or processed
      if (processedRef.current.has(id)) continue;
      if (queueRef.current.includes(id)) continue;
      
      newIdentifiers.push(id);
      
      // Mark as pending
      setStatusMap(prev => {
        const next = new Map(prev);
        next.set(id, { publicIdentifier: id, status: 'pending' });
        return next;
      });
    }

    if (newIdentifiers.length > 0) {
      queueRef.current.push(...newIdentifiers);
      setProgress(prev => ({ ...prev, total: prev.total + newIdentifiers.length }));
      processQueue();
    }
  }, [processQueue]);

  // Get merged lead with enriched data
  const getMergedLead = useCallback((lead: LinkedInSearchResult): LinkedInSearchResult & { company_identifier?: string } => {
    const enriched = enrichedMap.get(lead.public_identifier);
    if (!enriched) return lead;

    return {
      ...lead,
      // Prefer enriched data over search data
      headline: enriched.headline || lead.headline,
      job_title: enriched.job_title || lead.job_title,
      company: enriched.company || lead.company,
      company_linkedin: enriched.company_linkedin || lead.company_linkedin,
      company_identifier: enriched.company_identifier,
      industry: enriched.industry || lead.industry,
      seniority_level: enriched.seniority_level || lead.seniority_level,
      city: enriched.city || lead.city,
      state: enriched.state || lead.state,
      country: enriched.country || lead.country,
      email: enriched.email || lead.email,
      phone: enriched.phone || lead.phone,
      keywords: enriched.keywords || lead.keywords,
      about: enriched.about || lead.about,
      connections: enriched.connections ?? lead.connections,
      followers: enriched.followers ?? lead.followers,
      profile_picture_url: enriched.profile_picture_url || lead.profile_picture_url,
    };
  }, [enrichedMap]);

  // Check if lead is enriched
  const isEnriched = useCallback((publicIdentifier: string): boolean => {
    return statusMap.get(publicIdentifier)?.status === 'success';
  }, [statusMap]);

  // Get status for a lead
  const getStatus = useCallback((publicIdentifier: string): EnrichmentStatus | undefined => {
    return statusMap.get(publicIdentifier);
  }, [statusMap]);

  // Reset all state (on new search)
  const reset = useCallback(() => {
    setStatusMap(new Map());
    setEnrichedMap(new Map());
    queueRef.current = [];
    processedRef.current.clear();
    activeRef.current = 0;
    setProgress({ total: 0, completed: 0, failed: 0 });
  }, []);

  return {
    enrichLeads,
    getMergedLead,
    isEnriched,
    getStatus,
    reset,
    progress,
    statusMap,
  };
}
