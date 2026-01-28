import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLeadLists } from '@/hooks/useLeadLists';
import { 
  useLinkedInSearch, 
  LinkedInSearchResult, 
  LinkedInSearchFilters,
  emptyFilters 
} from '@/hooks/useLinkedInSearch';
import { useLinkedInEnrichPreview } from '@/hooks/useLinkedInEnrichPreview';
import { useSavedSearches, SavedSearch } from '@/hooks/useSavedSearches';
import { AutocompleteOption } from '@/hooks/useLinkedInAutocomplete';
import AppLayout from '@/components/layout/AppLayout';
import { LinkedInAutocomplete } from '@/components/linkedin/LinkedInAutocomplete';
import { SavedSearchesDropdown } from '@/components/linkedin/SavedSearchesDropdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  Search,
  Loader2,
  User,
  MapPin,
  Building2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  Download,
  AlertCircle,
  FolderPlus,
  FolderOpen,
  RefreshCw,
  Trash2,
  GraduationCap,
  Briefcase,
  Factory,
  Mail,
  Phone,
  Tag,
  Sparkles,
} from 'lucide-react';

// Custom LinkedIn icon
function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  );
}

// Serialize filters to URL params
function filtersToParams(filters: LinkedInSearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.keywords) params.set('keywords', filters.keywords);
  if (filters.title) params.set('title', filters.title);
  if (filters.company) params.set('company', filters.company);
  if (filters.location) params.set('location', filters.location);
  if (filters.locationIds.length) params.set('locationIds', JSON.stringify(filters.locationIds));
  if (filters.countryIds.length) params.set('countryIds', JSON.stringify(filters.countryIds));
  if (filters.stateIds.length) params.set('stateIds', JSON.stringify(filters.stateIds));
  if (filters.cityIds.length) params.set('cityIds', JSON.stringify(filters.cityIds));
  if (filters.companyIds.length) params.set('companyIds', JSON.stringify(filters.companyIds));
  if (filters.industryIds.length) params.set('industryIds', JSON.stringify(filters.industryIds));
  if (filters.schoolIds.length) params.set('schoolIds', JSON.stringify(filters.schoolIds));
  if (filters.titleIds.length) params.set('titleIds', JSON.stringify(filters.titleIds));
  return params;
}

// Parse filters from URL params
function paramsToFilters(params: URLSearchParams): LinkedInSearchFilters {
  const parseJson = (key: string): AutocompleteOption[] => {
    try {
      const val = params.get(key);
      return val ? JSON.parse(val) : [];
    } catch {
      return [];
    }
  };
  
  return {
    keywords: params.get('keywords') || '',
    title: params.get('title') || '',
    company: params.get('company') || '',
    location: params.get('location') || '',
    locationIds: parseJson('locationIds'),
    countryIds: parseJson('countryIds'),
    stateIds: parseJson('stateIds'),
    cityIds: parseJson('cityIds'),
    companyIds: parseJson('companyIds'),
    industryIds: parseJson('industryIds'),
    schoolIds: parseJson('schoolIds'),
    titleIds: parseJson('titleIds'),
  };
}

export default function LinkedInSearch() {
  const { currentWorkspace, user } = useAuth();
  const { lists, createList, refetchLists } = useLeadLists();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Search hook
  const { 
    results, 
    cursor, 
    isSearching, 
    hasMore, 
    error,
    usage,
    quotaBlocked,
    search, 
    clearResults 
  } = useLinkedInSearch({ workspaceId: currentWorkspace?.id });

  // Progressive enrichment hook
  const {
    enrichLeads,
    getMergedLead,
    isEnriched,
    getStatus,
    reset: resetEnrichment,
    progress: enrichProgress,
  } = useLinkedInEnrichPreview({ 
    workspaceId: currentWorkspace?.id,
    concurrency: 3,
  });

  // Saved searches hook
  const {
    searches: savedSearches,
    isLoading: isSavedSearchesLoading,
    isSaving,
    saveSearch,
    deleteSearch,
    markAsRun,
  } = useSavedSearches({ workspaceId: currentWorkspace?.id });

  // Filters state - initialize from URL
  const [filters, setFilters] = useState<LinkedInSearchFilters>(() => 
    paramsToFilters(searchParams)
  );

  // Pagination state
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  // Selection state - MAP that stores complete lead data across pages
  const [selectedLeadsMap, setSelectedLeadsMap] = useState<Map<string, LinkedInSearchResult>>(new Map());

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [listMode, setListMode] = useState<'new' | 'existing'>('new');
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [newListName, setNewListName] = useState('');
  const [newListDescription, setNewListDescription] = useState('');

  // Section open states
  const [basicOpen, setBasicOpen] = useState(true);
  const [companyOpen, setCompanyOpen] = useState(true);
  const [profileOpen, setProfileOpen] = useState(true);

  // Check if we have searched
  const [hasSearched, setHasSearched] = useState(false);

  // Get unique identifier for a result
  const getResultId = useCallback((result: LinkedInSearchResult) => {
    return result.provider_id || result.public_identifier || result.profile_url;
  }, []);

  // Check if all current page results are selected
  const allPageSelected = useMemo(() => {
    if (results.length === 0) return false;
    return results.every(r => selectedLeadsMap.has(getResultId(r)));
  }, [results, selectedLeadsMap, getResultId]);

  // Count of current page selected
  const pageSelectedCount = useMemo(() => {
    return results.filter(r => selectedLeadsMap.has(getResultId(r))).length;
  }, [results, selectedLeadsMap, getResultId]);

  // Total selected count
  const totalSelectedCount = selectedLeadsMap.size;

  // Check if filters have any value
  const hasActiveFilters = useMemo(() => {
    return (
      filters.keywords.trim() !== '' ||
      filters.title.trim() !== '' ||
      filters.company.trim() !== '' ||
      filters.location.trim() !== '' ||
      filters.locationIds.length > 0 ||
      filters.companyIds.length > 0 ||
      filters.industryIds.length > 0 ||
      filters.schoolIds.length > 0 ||
      filters.titleIds.length > 0
    );
  }, [filters]);

  // Check if at least one location is filled
  const hasLocation = useMemo(() => {
    return filters.locationIds.length > 0 || 
           filters.countryIds.length > 0 ||
           filters.stateIds.length > 0 ||
           filters.cityIds.length > 0 ||
           filters.location.trim() !== '';
  }, [filters]);

  const canSearch = hasLocation;

  // Update URL when filters change
  useEffect(() => {
    const params = filtersToParams(filters);
    setSearchParams(params, { replace: true });
  }, [filters, setSearchParams]);

  // Trigger progressive enrichment when results change
  useEffect(() => {
    if (results.length > 0) {
      // Reset enrichment state for new search
      resetEnrichment();
      // Enrich visible leads (first 10)
      const visibleLeads = results.slice(0, 10);
      enrichLeads(visibleLeads);
    }
  }, [results, enrichLeads, resetEnrichment]);
  // Handle search
  const handleSearch = useCallback(async () => {
    if (!canSearch) {
      toast({
        title: 'Localização obrigatória',
        description: 'Preencha pelo menos um campo de localização (País, Estado ou Cidade) para buscar.',
        variant: 'destructive',
      });
      return;
    }

    setCursorHistory([]);
    setCurrentPage(1);
    setHasSearched(true);
    resetEnrichment();
    await search(filters);
  }, [filters, search, toast, canSearch, resetEnrichment]);

  // Handle clear filters
  const handleClear = useCallback(() => {
    setFilters(emptyFilters);
    clearResults();
    setCursorHistory([]);
    setCurrentPage(1);
    setHasSearched(false);
    setSelectedLeadsMap(new Map());
    resetEnrichment();
  }, [clearResults, resetEnrichment]);

  // Handle next page
  const handleNextPage = useCallback(async () => {
    if (!cursor) return;
    setCursorHistory(prev => [...prev, cursor]);
    setCurrentPage(prev => prev + 1);
    await search(filters, cursor);
  }, [cursor, filters, search]);

  // Handle previous page
  const handlePrevPage = useCallback(async () => {
    if (cursorHistory.length === 0) return;
    
    const newHistory = [...cursorHistory];
    newHistory.pop();
    const prevCursor = newHistory.length > 0 ? newHistory[newHistory.length - 1] : undefined;
    
    setCursorHistory(newHistory.slice(0, -1));
    setCurrentPage(prev => Math.max(1, prev - 1));
    
    await search(filters, prevCursor);
  }, [cursorHistory, filters, search]);

  // Toggle single selection - stores complete lead data
  const toggleSelect = useCallback((result: LinkedInSearchResult) => {
    const id = getResultId(result);
    setSelectedLeadsMap(prev => {
      const next = new Map(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.set(id, result);
      }
      return next;
    });
  }, [getResultId]);

  // Toggle all on current page
  const toggleAllPage = useCallback(() => {
    if (allPageSelected) {
      setSelectedLeadsMap(prev => {
        const next = new Map(prev);
        results.forEach(r => next.delete(getResultId(r)));
        return next;
      });
    } else {
      setSelectedLeadsMap(prev => {
        const next = new Map(prev);
        results.forEach(r => next.set(getResultId(r), r));
        return next;
      });
    }
  }, [allPageSelected, results, getResultId]);

  // Clear all selections
  const clearSelection = useCallback(() => {
    setSelectedLeadsMap(new Map());
  }, []);

  // Handle import - uses selectedLeadsMap which has all data
  const handleImport = useCallback(async () => {
    if (!currentWorkspace) return;
    
    if (totalSelectedCount === 0) {
      toast({
        title: 'Selecione leads',
        description: 'Escolha pelo menos um lead para importar.',
        variant: 'destructive',
      });
      return;
    }

    if (listMode === 'new' && !newListName.trim()) {
      toast({
        title: 'Nome obrigatório',
        description: 'Informe o nome da nova lista.',
        variant: 'destructive',
      });
      return;
    }

    if (listMode === 'existing' && !selectedListId) {
      toast({
        title: 'Selecione uma lista',
        description: 'Escolha uma lista existente.',
        variant: 'destructive',
      });
      return;
    }

    setIsImporting(true);

    try {
      // Get all selected leads from the Map
      const selectedResults = Array.from(selectedLeadsMap.values());

      // Create list if needed
      let targetListId = selectedListId;
      if (listMode === 'new') {
        const newList = await createList({
          name: newListName.trim(),
          description: newListDescription.trim() || undefined,
        });
        targetListId = newList.id;
      }

      // Insert leads with enriched data
      const leadsToInsert = selectedResults.map(lead => ({
        workspace_id: currentWorkspace.id,
        list_id: targetListId,
        full_name: lead.full_name || `${lead.first_name} ${lead.last_name}`.trim(),
        first_name: lead.first_name || null,
        last_name: lead.last_name || null,
        headline: lead.headline || null,
        linkedin_url: lead.profile_url,
        linkedin_public_identifier: lead.public_identifier || null,
        linkedin_provider_id: lead.provider_id || null,
        // Location fields
        city: lead.city || null,
        state: lead.state || null,
        country: lead.country || null,
        // Professional data
        company: lead.company || null,
        company_linkedin: lead.company_linkedin || null,
        job_title: lead.job_title || null,
        industry: lead.industry || null,
        seniority_level: lead.seniority_level || null,
        // Contact info
        email: lead.email || null,
        personal_email: lead.personal_email || null,
        phone: lead.phone || null,
        mobile_number: lead.mobile_number || null,
        // Skills and about
        keywords: lead.keywords || null,
        about: lead.about || null,
        // Social metrics
        connections: lead.connections || null,
        followers: lead.followers || null,
        // Profile picture
        profile_picture_url: lead.profile_picture_url || null,
        // Mark as enriched
        last_enriched_at: new Date().toISOString(),
      }));

      const { error: insertError } = await supabase
        .from('leads')
        .insert(leadsToInsert as any);

      if (insertError) throw insertError;

      toast({
        title: 'Leads importados',
        description: `${selectedResults.length} leads importados com sucesso.`,
      });

      // Clear selection
      setSelectedLeadsMap(new Map());
      setNewListName('');
      setNewListDescription('');
      setSelectedListId('');
      refetchLists();

    } catch (err: any) {
      toast({
        title: 'Erro ao importar',
        description: err.message || 'Não foi possível importar os leads',
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
    }
  }, [
    currentWorkspace,
    totalSelectedCount,
    listMode,
    newListName,
    newListDescription,
    selectedListId,
    selectedLeadsMap,
    createList,
    refetchLists,
    toast,
  ]);

  // Load saved search
  const handleLoadSavedSearch = useCallback((savedSearch: SavedSearch) => {
    const loadedFilters = savedSearch.filters_json as LinkedInSearchFilters;
    setFilters({
      ...emptyFilters,
      ...loadedFilters,
    });
    markAsRun(savedSearch.id);
    toast({
      title: 'Pesquisa carregada',
      description: `"${savedSearch.name}" foi carregada. Clique em Buscar para executar.`,
    });
  }, [markAsRun, toast]);

  // Save current search
  const handleSaveSearch = useCallback(async (name: string, isShared: boolean) => {
    await saveSearch(name, filters, 'classic', isShared);
  }, [saveSearch, filters]);

  return (
    <AppLayout>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/leads')}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <LinkedInIcon className="h-6 w-6 text-[#0A66C2]" />
                Buscar no LinkedIn
              </h1>
              <p className="text-muted-foreground text-sm">
                Encontre leads e importe para suas listas
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Enrichment progress */}
            {enrichProgress.total > 0 && enrichProgress.completed < enrichProgress.total && (
              <Badge variant="outline" className="text-xs animate-pulse">
                <Sparkles className="h-3 w-3 mr-1" />
                {enrichProgress.completed}/{enrichProgress.total} enriquecidos
              </Badge>
            )}
            
            {/* Usage indicator */}
            {usage && (
              <Badge variant="outline" className="text-xs">
                {usage.current}/{usage.limit} buscas hoje
              </Badge>
            )}
            
            {/* Saved searches */}
            <SavedSearchesDropdown
              searches={savedSearches}
              isLoading={isSavedSearchesLoading}
              isSaving={isSaving}
              onLoad={handleLoadSavedSearch}
              onSave={handleSaveSearch}
              onDelete={deleteSearch}
              hasActiveFilters={hasActiveFilters}
            />
          </div>
        </div>

        {/* Quota blocked banner */}
        {quotaBlocked && (
          <div className="flex-shrink-0 flex items-center justify-between bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-3 mb-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <div>
                <p className="font-medium text-destructive">Limite diário atingido</p>
                <p className="text-sm text-muted-foreground">
                  Você usou {quotaBlocked.usage.current}/{quotaBlocked.usage.limit} buscas hoje no plano {quotaBlocked.plan.name}.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate('/settings')}>
              Ver plano e limites
            </Button>
          </div>
        )}

        {/* Selection bar */}
        {totalSelectedCount > 0 && (
          <div className="flex-shrink-0 flex items-center justify-between bg-primary/10 border border-primary/20 rounded-lg px-4 py-2 mb-4">
            <div className="flex items-center gap-3">
              <Badge className="text-sm px-3 py-1">
                {totalSelectedCount} selecionado{totalSelectedCount !== 1 ? 's' : ''}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {pageSelectedCount > 0 && `(${pageSelectedCount} desta página)`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                <Trash2 className="h-4 w-4 mr-1" />
                Limpar seleção
              </Button>
            </div>
          </div>
        )}

        {/* Main content - two columns */}
        <div className="flex-1 flex gap-6 min-h-0">
          {/* Left sidebar - filters */}
          <div className="w-80 flex-shrink-0">
            <ScrollArea className="h-full pr-4">
              <div className="space-y-4">
                {/* Basic filters */}
                <Collapsible open={basicOpen} onOpenChange={setBasicOpen}>
                  <Card>
                    <CollapsibleTrigger asChild>
                      <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 rounded-t-lg">
                        <CardTitle className="text-sm flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <Search className="h-4 w-4" />
                            Básico
                          </span>
                          <ChevronDown className={`h-4 w-4 transition-transform ${basicOpen ? '' : '-rotate-90'}`} />
                        </CardTitle>
                      </CardHeader>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="space-y-4 pt-0">
                        <div className="space-y-2">
                          <Label htmlFor="keywords">Palavras-chave</Label>
                          <Input
                            id="keywords"
                            placeholder="Ex: marketing digital"
                            value={filters.keywords}
                            onChange={e => setFilters(prev => ({ ...prev, keywords: e.target.value }))}
                            disabled={isSearching}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Localização <span className="text-destructive">*</span></Label>
                          <LinkedInAutocomplete
                            workspaceId={currentWorkspace?.id}
                            type="location"
                            placeholder="Buscar país, estado ou cidade..."
                            value={filters.locationIds}
                            onChange={val => setFilters(prev => ({ ...prev, locationIds: val }))}
                            disabled={isSearching}
                          />
                          <p className="text-xs text-muted-foreground">
                            Digite para buscar e selecione da lista
                          </p>
                        </div>
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>

                {/* Company filters */}
                <Collapsible open={companyOpen} onOpenChange={setCompanyOpen}>
                  <Card>
                    <CollapsibleTrigger asChild>
                      <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 rounded-t-lg">
                        <CardTitle className="text-sm flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <Building2 className="h-4 w-4" />
                            Empresa
                          </span>
                          <ChevronDown className={`h-4 w-4 transition-transform ${companyOpen ? '' : '-rotate-90'}`} />
                        </CardTitle>
                      </CardHeader>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="space-y-4 pt-0">
                        <div className="space-y-2">
                          <Label>Empresa atual</Label>
                          <LinkedInAutocomplete
                            workspaceId={currentWorkspace?.id}
                            type="company"
                            placeholder="Buscar empresa..."
                            value={filters.companyIds}
                            onChange={val => setFilters(prev => ({ ...prev, companyIds: val, company: '' }))}
                            disabled={isSearching}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Indústria</Label>
                          <LinkedInAutocomplete
                            workspaceId={currentWorkspace?.id}
                            type="industry"
                            placeholder="Buscar indústria..."
                            value={filters.industryIds}
                            onChange={val => setFilters(prev => ({ ...prev, industryIds: val }))}
                            disabled={isSearching}
                          />
                        </div>
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>

                {/* Profile filters */}
                <Collapsible open={profileOpen} onOpenChange={setProfileOpen}>
                  <Card>
                    <CollapsibleTrigger asChild>
                      <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 rounded-t-lg">
                        <CardTitle className="text-sm flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <Briefcase className="h-4 w-4" />
                            Perfil
                          </span>
                          <ChevronDown className={`h-4 w-4 transition-transform ${profileOpen ? '' : '-rotate-90'}`} />
                        </CardTitle>
                      </CardHeader>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="space-y-4 pt-0">
                        <div className="space-y-2">
                          <Label>Cargo</Label>
                          <LinkedInAutocomplete
                            workspaceId={currentWorkspace?.id}
                            type="title"
                            placeholder="Buscar cargo..."
                            value={filters.titleIds}
                            onChange={val => setFilters(prev => ({ ...prev, titleIds: val, title: '' }))}
                            disabled={isSearching}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Formação</Label>
                          <LinkedInAutocomplete
                            workspaceId={currentWorkspace?.id}
                            type="school"
                            placeholder="Buscar escola/universidade..."
                            value={filters.schoolIds}
                            onChange={val => setFilters(prev => ({ ...prev, schoolIds: val }))}
                            disabled={isSearching}
                          />
                        </div>
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>

                {/* Search buttons */}
                <div className="flex gap-2">
                  <Button
                    onClick={handleSearch}
                    disabled={!canSearch || isSearching}
                    className="flex-1"
                  >
                    {isSearching ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="mr-2 h-4 w-4" />
                    )}
                    Buscar
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleClear}
                    disabled={isSearching}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {/* Import section - only show when leads selected */}
                {totalSelectedCount > 0 && (
                  <Card className="border-primary">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Download className="h-4 w-4" />
                        Importar Leads
                      </CardTitle>
                      <CardDescription>
                        {totalSelectedCount} lead{totalSelectedCount !== 1 ? 's' : ''} selecionado{totalSelectedCount !== 1 ? 's' : ''}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-0">
                      <Tabs value={listMode} onValueChange={(v) => setListMode(v as 'new' | 'existing')}>
                        <TabsList className="grid w-full grid-cols-2">
                          <TabsTrigger value="new" className="flex items-center gap-1 text-xs">
                            <FolderPlus className="h-3 w-3" />
                            Nova
                          </TabsTrigger>
                          <TabsTrigger value="existing" className="flex items-center gap-1 text-xs">
                            <FolderOpen className="h-3 w-3" />
                            Existente
                          </TabsTrigger>
                        </TabsList>
                        
                        <TabsContent value="new" className="space-y-3 mt-3">
                          <div className="space-y-2">
                            <Label htmlFor="new-list-name" className="text-xs">Nome *</Label>
                            <Input
                              id="new-list-name"
                              placeholder="Ex: CEOs Brasil 2024"
                              value={newListName}
                              onChange={e => setNewListName(e.target.value)}
                              disabled={isImporting}
                              className="h-8 text-sm"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="new-list-desc" className="text-xs">Descrição</Label>
                            <Textarea
                              id="new-list-desc"
                              placeholder="Detalhes..."
                              value={newListDescription}
                              onChange={e => setNewListDescription(e.target.value)}
                              disabled={isImporting}
                              rows={2}
                              className="text-sm"
                            />
                          </div>
                        </TabsContent>
                        
                        <TabsContent value="existing" className="mt-3">
                          <div className="space-y-2">
                            <Label className="text-xs">Selecione a lista</Label>
                            <Select
                              value={selectedListId}
                              onValueChange={setSelectedListId}
                              disabled={isImporting}
                            >
                              <SelectTrigger className="h-8 text-sm">
                                <SelectValue placeholder="Escolha uma lista" />
                              </SelectTrigger>
                              <SelectContent>
                                {lists.map(list => (
                                  <SelectItem key={list.id} value={list.id}>
                                    {list.name}
                                  </SelectItem>
                                ))}
                                {lists.length === 0 && (
                                  <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                                    Nenhuma lista encontrada
                                  </div>
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                        </TabsContent>
                      </Tabs>

                      <Button
                        onClick={handleImport}
                        disabled={isImporting || totalSelectedCount === 0}
                        className="w-full"
                        size="sm"
                      >
                        {isImporting ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="mr-2 h-4 w-4" />
                        )}
                        Importar {totalSelectedCount}
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Right content - results */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* Results header */}
            {hasSearched && results.length > 0 && (
              <div className="flex-shrink-0 flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={allPageSelected}
                      onCheckedChange={toggleAllPage}
                      disabled={isSearching}
                    />
                    <span className="text-sm text-muted-foreground">
                      Selecionar página ({results.length})
                    </span>
                  </div>
                  
                  {/* Enrichment progress indicator */}
                  {enrichProgress.total > 0 && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Sparkles className="h-3 w-3" />
                      <span>
                        {enrichProgress.completed}/{enrichProgress.total} enriquecidos
                        {enrichProgress.failed > 0 && (
                          <span className="text-destructive ml-1">
                            ({enrichProgress.failed} falhas)
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                </div>

                {/* Pagination */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Página {currentPage}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePrevPage}
                    disabled={currentPage === 1 || isSearching}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNextPage}
                    disabled={!hasMore || isSearching}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Results list */}
            <ScrollArea className="flex-1">
              {/* Error state */}
              {error && (
                <Card className="border-destructive">
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <AlertCircle className="h-12 w-12 text-destructive mb-4" />
                    <p className="text-center text-destructive font-medium mb-2">
                      Erro na busca
                    </p>
                    <p className="text-center text-muted-foreground text-sm max-w-md">
                      {error}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Loading state */}
              {isSearching && (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                    <p className="text-muted-foreground">Buscando leads no LinkedIn...</p>
                  </CardContent>
                </Card>
              )}

              {/* Empty state - no search yet */}
              {!hasSearched && !isSearching && !error && (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-16">
                    <LinkedInIcon className="h-16 w-16 text-[#0A66C2] mb-4" />
                    <h3 className="text-lg font-medium mb-2">Busque leads no LinkedIn</h3>
                    <p className="text-muted-foreground text-center max-w-md">
                      Use os filtros à esquerda para encontrar profissionais no LinkedIn.
                      Preencha pelo menos um filtro e clique em Buscar.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Empty results */}
              {hasSearched && !isSearching && results.length === 0 && !error && (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Search className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">
                      Nenhum resultado encontrado. Tente ajustar os filtros.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Results list */}
              {!isSearching && results.length > 0 && (
                <div className="space-y-2">
                  {results.map(rawResult => {
                    const id = getResultId(rawResult);
                    const result = getMergedLead(rawResult); // Use enriched data
                    const isSelected = selectedLeadsMap.has(id);
                    const status = getStatus(rawResult.public_identifier);
                    
                    // Determine if we have structured data (from enrich, not headline parse)
                    const hasJobTitle = !!result.job_title;
                    const hasCompany = !!result.company;
                    const hasEnrichedData = !!(result.email || result.keywords || result.about || hasJobTitle);
                    
                    // Determine badge based on enrich status
                    let enrichBadge = null;
                    if (status?.status === 'loading') {
                      enrichBadge = (
                        <Badge variant="outline" className="text-xs flex-shrink-0 animate-pulse">
                          <Sparkles className="h-3 w-3 mr-1" />
                          Enriquecendo...
                        </Badge>
                      );
                    } else if (hasEnrichedData) {
                      enrichBadge = (
                        <Badge variant="outline" className="text-xs flex-shrink-0 text-primary border-primary">
                          Completo
                        </Badge>
                      );
                    } else if (status?.status === 'error') {
                      enrichBadge = (
                        <Badge variant="outline" className="text-xs flex-shrink-0 text-muted-foreground">
                          Parcial
                        </Badge>
                      );
                    } else if (!status || status.status === 'pending') {
                      enrichBadge = (
                        <Badge variant="outline" className="text-xs flex-shrink-0 text-muted-foreground">
                          Parcial
                        </Badge>
                      );
                    }
                    
                    // Build display: prioritize structured job_title/company, headline as fallback
                    const displayTitle = hasJobTitle ? result.job_title : null;
                    const displayCompany = hasCompany ? result.company : null;
                    // Only show headline if we don't have structured data
                    const showHeadline = !hasJobTitle && !hasCompany && result.headline;
                    
                    return (
                      <Card
                        key={id}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'hover:bg-muted/50'
                        }`}
                        onClick={() => toggleSelect(result)}
                      >
                        <CardContent className="flex items-start gap-4 py-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(result)}
                            onClick={e => e.stopPropagation()}
                            className="mt-1"
                          />
                          
                          {/* Avatar */}
                          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                            {result.profile_picture_url ? (
                              <img
                                src={result.profile_picture_url}
                                alt={result.full_name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <User className="h-6 w-6 text-muted-foreground" />
                            )}
                          </div>
                          
                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            {/* Name + badges */}
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">
                                {result.full_name || `${result.first_name} ${result.last_name}`}
                              </span>
                              {result.connection_degree && (
                                <Badge variant="secondary" className="text-xs flex-shrink-0">
                                  {result.connection_degree}º
                                </Badge>
                              )}
                              {enrichBadge}
                            </div>
                            
                            {/* Primary: Job Title + Company (structured) */}
                            {(displayTitle || displayCompany) && (
                              <div className="flex items-center gap-2 mt-0.5">
                                {displayTitle && (
                                  <span className="text-sm font-medium text-foreground truncate">
                                    {displayTitle}
                                  </span>
                                )}
                                {displayTitle && displayCompany && (
                                  <span className="text-muted-foreground">@</span>
                                )}
                                {displayCompany && (
                                  <span className="text-sm text-muted-foreground truncate">
                                    {displayCompany}
                                  </span>
                                )}
                              </div>
                            )}
                            
                            {/* Fallback: Headline only if no structured data */}
                            {showHeadline && (
                              <p className="text-sm text-muted-foreground truncate italic">
                                {result.headline}
                              </p>
                            )}
                            
                            {/* Secondary row: Location + Industry + Seniority */}
                            <div className="flex items-center gap-3 mt-1 flex-wrap">
                              {(result.city || result.location) && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <MapPin className="h-3 w-3 flex-shrink-0" />
                                  <span className="truncate">
                                    {result.city ? [result.city, result.state, result.country].filter(Boolean).join(', ') : result.location}
                                  </span>
                                </div>
                              )}
                              {result.industry && (
                                <Badge variant="outline" className="text-xs">
                                  <Factory className="h-3 w-3 mr-1" />
                                  {result.industry}
                                </Badge>
                              )}
                              {result.seniority_level && (
                                <Badge variant="outline" className="text-xs">
                                  <Briefcase className="h-3 w-3 mr-1" />
                                  {result.seniority_level}
                                </Badge>
                              )}
                            </div>
                            
                            {/* Contact info row (enriched) */}
                            {(result.email || result.phone) && (
                              <div className="flex items-center gap-3 mt-1">
                                {result.email && (
                                  <div className="flex items-center gap-1 text-xs text-primary">
                                    <Mail className="h-3 w-3" />
                                    <span className="truncate">{result.email}</span>
                                  </div>
                                )}
                                {result.phone && (
                                  <div className="flex items-center gap-1 text-xs text-primary">
                                    <Phone className="h-3 w-3" />
                                    <span className="truncate">{result.phone}</span>
                                  </div>
                                )}
                              </div>
                            )}
                            
                            {/* Skills row (enriched) */}
                            {result.keywords && (
                              <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                                <Tag className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate">{result.keywords}</span>
                              </div>
                            )}
                          </div>
                          
                          {/* External link */}
                          <a
                            href={result.profile_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-muted-foreground hover:text-primary flex-shrink-0 mt-1"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </ScrollArea>

            {/* Bottom pagination */}
            {hasSearched && results.length > 0 && (
              <div className="flex-shrink-0 flex justify-center py-4 border-t mt-4">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={handlePrevPage}
                    disabled={currentPage === 1 || isSearching}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Anterior
                  </Button>
                  <span className="px-4 text-sm text-muted-foreground">
                    Página {currentPage}
                  </span>
                  <Button
                    variant="outline"
                    onClick={handleNextPage}
                    disabled={!hasMore || isSearching}
                  >
                    Próxima
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
