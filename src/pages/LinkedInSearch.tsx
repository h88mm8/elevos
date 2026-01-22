import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLeadLists } from '@/hooks/useLeadLists';
import { useLinkedInSearch, LinkedInSearchResult, LinkedInSearchFilters } from '@/hooks/useLinkedInSearch';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  X,
  Download,
  AlertCircle,
  FolderPlus,
  FolderOpen,
} from 'lucide-react';

// Custom LinkedIn icon
function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  );
}

export default function LinkedInSearch() {
  const { currentWorkspace } = useAuth();
  const { lists, createList, refetchLists } = useLeadLists();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Search hook
  const { 
    results, 
    cursor, 
    isSearching, 
    hasMore, 
    error,
    search, 
    clearResults 
  } = useLinkedInSearch({ workspaceId: currentWorkspace?.id });

  // Filters state
  const [filters, setFilters] = useState<LinkedInSearchFilters>({
    keywords: '',
    title: '',
    company: '',
    location: '',
  });

  // Pagination state - track current and previous cursors
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  // Selection state - persists across pages
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [listMode, setListMode] = useState<'new' | 'existing'>('new');
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [newListName, setNewListName] = useState('');
  const [newListDescription, setNewListDescription] = useState('');

  // Check if we have searched at least once
  const [hasSearched, setHasSearched] = useState(false);

  // Get unique identifier for a result
  const getResultId = useCallback((result: LinkedInSearchResult) => {
    return result.provider_id || result.public_identifier || result.profile_url;
  }, []);

  // Check if all current page results are selected
  const allPageSelected = useMemo(() => {
    if (results.length === 0) return false;
    return results.every(r => selectedIds.has(getResultId(r)));
  }, [results, selectedIds, getResultId]);

  // Count of current page selected
  const pageSelectedCount = useMemo(() => {
    return results.filter(r => selectedIds.has(getResultId(r))).length;
  }, [results, selectedIds, getResultId]);

  // Handle search
  const handleSearch = useCallback(async () => {
    if (!filters.keywords.trim() && !filters.title.trim() && !filters.company.trim()) {
      toast({
        title: 'Filtros obrigatórios',
        description: 'Preencha pelo menos um filtro (palavras-chave, cargo ou empresa).',
        variant: 'destructive',
      });
      return;
    }

    setCursorHistory([]);
    setCurrentPage(1);
    setHasSearched(true);
    await search(filters);
  }, [filters, search, toast]);

  // Handle clear filters
  const handleClear = useCallback(() => {
    setFilters({ keywords: '', title: '', company: '', location: '' });
    clearResults();
    setCursorHistory([]);
    setCurrentPage(1);
    setHasSearched(false);
    setSelectedIds(new Set());
  }, [clearResults]);

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
    newHistory.pop(); // Remove current page's cursor
    const prevCursor = newHistory.length > 0 ? newHistory[newHistory.length - 1] : undefined;
    
    setCursorHistory(newHistory.slice(0, -1)); // Remove the last one we're going back to
    setCurrentPage(prev => Math.max(1, prev - 1));
    
    // If going back to page 1, search without cursor
    await search(filters, prevCursor);
  }, [cursorHistory, filters, search]);

  // Toggle single selection
  const toggleSelect = useCallback((result: LinkedInSearchResult) => {
    const id = getResultId(result);
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, [getResultId]);

  // Toggle all on current page
  const toggleAllPage = useCallback(() => {
    if (allPageSelected) {
      // Deselect all on current page
      setSelectedIds(prev => {
        const next = new Set(prev);
        results.forEach(r => next.delete(getResultId(r)));
        return next;
      });
    } else {
      // Select all on current page
      setSelectedIds(prev => {
        const next = new Set(prev);
        results.forEach(r => next.add(getResultId(r)));
        return next;
      });
    }
  }, [allPageSelected, results, getResultId]);

  // Handle import
  const handleImport = useCallback(async () => {
    if (!currentWorkspace) return;
    
    if (selectedIds.size === 0) {
      toast({
        title: 'Selecione leads',
        description: 'Escolha pelo menos um lead para importar.',
        variant: 'destructive',
      });
      return;
    }

    // Validate list selection
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
      // Get selected leads from current results that are selected
      // Note: We only have access to current page results, but selection persists
      // For MVP, we import what's visible and selected on current page
      const selectedResults = results.filter(r => selectedIds.has(getResultId(r)));

      if (selectedResults.length === 0) {
        toast({
          title: 'Leads não encontrados',
          description: 'Os leads selecionados não estão na página atual. Navegue para a página com os leads selecionados.',
          variant: 'destructive',
        });
        setIsImporting(false);
        return;
      }

      // Create list if needed
      let targetListId = selectedListId;
      if (listMode === 'new') {
        const newList = await createList({
          name: newListName.trim(),
          description: newListDescription.trim() || undefined,
        });
        targetListId = newList.id;
      }

      // Insert leads with deduplication by linkedin_url or provider_id
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
        city: lead.location || null,
        company: lead.company || null,
        job_title: lead.job_title || null,
      }));

      const { error: insertError } = await supabase
        .from('leads')
        .insert(leadsToInsert as any);

      if (insertError) throw insertError;

      toast({
        title: 'Leads importados',
        description: `${selectedResults.length} leads importados com sucesso.`,
      });

      // Clear selection for imported leads
      setSelectedIds(prev => {
        const next = new Set(prev);
        selectedResults.forEach(r => next.delete(getResultId(r)));
        return next;
      });

      // Reset form
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
    selectedIds,
    listMode,
    newListName,
    newListDescription,
    selectedListId,
    results,
    getResultId,
    createList,
    refetchLists,
    toast,
  ]);

  const canSearch = filters.keywords.trim() || filters.title.trim() || filters.company.trim();

  return (
    <AppLayout>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between mb-6">
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
                Encontre leads no LinkedIn e importe para suas listas
              </p>
            </div>
          </div>
          
          {selectedIds.size > 0 && (
            <Badge variant="secondary" className="text-base px-3 py-1">
              {selectedIds.size} selecionado{selectedIds.size !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>

        {/* Main content - two columns */}
        <div className="flex-1 flex gap-6 min-h-0">
          {/* Left sidebar - filters */}
          <div className="w-80 flex-shrink-0">
            <div className="sticky top-0 space-y-4">
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Search className="h-4 w-4" />
                    Filtros de Busca
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
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
                    <Label htmlFor="title">Cargo</Label>
                    <Input
                      id="title"
                      placeholder="Ex: CEO, Diretor"
                      value={filters.title}
                      onChange={e => setFilters(prev => ({ ...prev, title: e.target.value }))}
                      disabled={isSearching}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="company">Empresa</Label>
                    <Input
                      id="company"
                      placeholder="Ex: Google, Microsoft"
                      value={filters.company}
                      onChange={e => setFilters(prev => ({ ...prev, company: e.target.value }))}
                      disabled={isSearching}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="location">Localização</Label>
                    <Input
                      id="location"
                      placeholder="Ex: São Paulo, Brasil"
                      value={filters.location}
                      onChange={e => setFilters(prev => ({ ...prev, location: e.target.value }))}
                      disabled={isSearching}
                    />
                  </div>

                  <div className="flex gap-2 pt-2">
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
                </CardContent>
              </Card>

              {/* Save to list section */}
              {selectedIds.size > 0 && (
                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Download className="h-4 w-4" />
                      Salvar em Lista
                    </CardTitle>
                    <CardDescription>
                      Importe os {selectedIds.size} lead{selectedIds.size !== 1 ? 's' : ''} selecionado{selectedIds.size !== 1 ? 's' : ''}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Tabs value={listMode} onValueChange={(v) => setListMode(v as 'new' | 'existing')}>
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="new" className="flex items-center gap-1">
                          <FolderPlus className="h-3 w-3" />
                          Nova
                        </TabsTrigger>
                        <TabsTrigger value="existing" className="flex items-center gap-1">
                          <FolderOpen className="h-3 w-3" />
                          Existente
                        </TabsTrigger>
                      </TabsList>
                      
                      <TabsContent value="new" className="space-y-3 mt-3">
                        <div className="space-y-2">
                          <Label htmlFor="new-list-name">Nome da lista *</Label>
                          <Input
                            id="new-list-name"
                            placeholder="Ex: CEOs Brasil 2024"
                            value={newListName}
                            onChange={e => setNewListName(e.target.value)}
                            disabled={isImporting}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="new-list-desc">Descrição (opcional)</Label>
                          <Textarea
                            id="new-list-desc"
                            placeholder="Detalhes sobre a busca..."
                            value={newListDescription}
                            onChange={e => setNewListDescription(e.target.value)}
                            disabled={isImporting}
                            rows={2}
                          />
                        </div>
                      </TabsContent>
                      
                      <TabsContent value="existing" className="mt-3">
                        <div className="space-y-2">
                          <Label>Selecione a lista</Label>
                          <Select
                            value={selectedListId}
                            onValueChange={setSelectedListId}
                            disabled={isImporting}
                          >
                            <SelectTrigger>
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
                      disabled={isImporting || selectedIds.size === 0}
                      className="w-full"
                    >
                      {isImporting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      Importar {selectedIds.size} lead{selectedIds.size !== 1 ? 's' : ''}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
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
                      Selecionar todos desta página ({results.length})
                    </span>
                  </div>
                  {pageSelectedCount > 0 && (
                    <Badge variant="outline">
                      {pageSelectedCount} desta página
                    </Badge>
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
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNextPage}
                    disabled={!hasMore || isSearching}
                  >
                    Próxima
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Results list */}
            <div className="flex-1 overflow-auto">
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
                  {results.map(result => {
                    const id = getResultId(result);
                    const isSelected = selectedIds.has(id);
                    
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
                        <CardContent className="flex items-center gap-4 py-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(result)}
                            onClick={e => e.stopPropagation()}
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
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">
                                {result.full_name || `${result.first_name} ${result.last_name}`}
                              </span>
                              {result.connection_degree && (
                                <Badge variant="secondary" className="text-xs flex-shrink-0">
                                  {result.connection_degree}º
                                </Badge>
                              )}
                            </div>
                            {result.headline && (
                              <p className="text-sm text-muted-foreground truncate">
                                {result.headline}
                              </p>
                            )}
                            <div className="flex items-center gap-3 mt-1">
                              {result.location && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <MapPin className="h-3 w-3" />
                                  <span className="truncate">{result.location}</span>
                                </div>
                              )}
                              {result.company && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Building2 className="h-3 w-3" />
                                  <span className="truncate">{result.company}</span>
                                </div>
                              )}
                            </div>
                          </div>
                          
                          {/* External link */}
                          <a
                            href={result.profile_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-muted-foreground hover:text-primary flex-shrink-0"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

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
