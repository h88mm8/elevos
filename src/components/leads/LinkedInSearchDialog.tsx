import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Loader2, 
  Search, 
  Plus, 
  FolderOpen, 
  User, 
  MapPin,
  AlertCircle,
  Download,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { LeadList } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface LinkedInSearchResult {
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
}

interface LinkedInSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lists: LeadList[];
  workspaceId: string;
  onImportComplete: () => void;
}

type Step = 'config' | 'results';

export function LinkedInSearchDialog({
  open,
  onOpenChange,
  lists,
  workspaceId,
  onImportComplete,
}: LinkedInSearchDialogProps) {
  const { toast } = useToast();

  // Step state
  const [step, setStep] = useState<Step>('config');

  // Config state
  const [keywords, setKeywords] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [company, setCompany] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [limit, setLimit] = useState(25);

  // Results state
  const [results, setResults] = useState<LinkedInSearchResult[]>([]);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Loading states
  const [isSearching, setIsSearching] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // List selection state
  const [listMode, setListMode] = useState<'existing' | 'new'>('new');
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [newListName, setNewListName] = useState('');
  const [newListDescription, setNewListDescription] = useState('');

  function resetState() {
    setStep('config');
    setKeywords('');
    setJobTitle('');
    setCompany('');
    setLocationFilter('');
    setLimit(25);
    setResults([]);
    setSelectedResults(new Set());
    setCursor(null);
    setHasMore(false);
    setListMode('new');
    setSelectedListId(null);
    setNewListName('');
    setNewListDescription('');
  }

  function handleOpenChange(newOpen: boolean) {
    if (!isSearching && !isImporting) {
      onOpenChange(newOpen);
      if (!newOpen) {
        resetState();
      }
    }
  }

  async function handleSearch(loadMore = false) {
    if (!keywords.trim() && !jobTitle.trim() && !company.trim()) {
      toast({
        title: 'Filtros obrigatórios',
        description: 'Preencha pelo menos um filtro para buscar.',
        variant: 'destructive',
      });
      return;
    }

    loadMore ? setIsLoadingMore(true) : setIsSearching(true);

    try {
      const { data, error } = await supabase.functions.invoke('linkedin-search', {
        body: {
          workspaceId,
          searchType: 'people',
          filters: {
            keywords: keywords.trim() || undefined,
            title: jobTitle.trim() || undefined,
            company: company.trim() || undefined,
            location: locationFilter.trim() || undefined,
          },
          limit,
          cursor: loadMore ? cursor : undefined,
        },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      const newResults = data.results || [];
      
      if (loadMore) {
        setResults(prev => [...prev, ...newResults]);
      } else {
        setResults(newResults);
        setStep('results');
      }

      setCursor(data.cursor || null);
      setHasMore(!!data.cursor && newResults.length > 0);

      if (newResults.length === 0 && !loadMore) {
        toast({
          title: 'Nenhum resultado',
          description: 'Tente ajustar os filtros da busca.',
        });
      }
    } catch (error: any) {
      // Check if global account not configured
      const errorMsg = error.message || '';
      if (errorMsg.includes('global') || errorMsg.includes('configurada') || errorMsg.includes('not configured')) {
        toast({
          title: 'Busca LinkedIn indisponível',
          description: 'Peça ao administrador para configurar a conta global do LinkedIn.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Erro na busca',
          description: errorMsg || 'Não foi possível buscar no LinkedIn',
          variant: 'destructive',
        });
      }
    } finally {
      setIsSearching(false);
      setIsLoadingMore(false);
    }
  }

  function toggleSelectAll() {
    if (selectedResults.size === results.length) {
      setSelectedResults(new Set());
    } else {
      setSelectedResults(new Set(results.map(r => r.provider_id)));
    }
  }

  function toggleSelect(providerId: string) {
    const next = new Set(selectedResults);
    if (next.has(providerId)) {
      next.delete(providerId);
    } else {
      next.add(providerId);
    }
    setSelectedResults(next);
  }

  async function handleImport() {
    if (selectedResults.size === 0) {
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
      // Get selected leads data
      const selectedLeads = results.filter(r => selectedResults.has(r.provider_id));

      // Create list if needed
      let targetListId = selectedListId;
      if (listMode === 'new') {
        const { data: newList, error: listError } = await supabase
          .from('lead_lists')
          .insert({
            workspace_id: workspaceId,
            name: newListName.trim(),
            description: newListDescription.trim() || null,
          })
          .select()
          .single();

        if (listError) throw listError;
        targetListId = newList.id;
      }

      // Insert leads
      const leadsToInsert = selectedLeads.map(lead => ({
        workspace_id: workspaceId,
        list_id: targetListId,
        full_name: lead.full_name || `${lead.first_name} ${lead.last_name}`.trim(),
        first_name: lead.first_name || null,
        last_name: lead.last_name || null,
        headline: lead.headline || null,
        linkedin_url: lead.profile_url,
        city: lead.location || null,
      }));

      const { error: insertError } = await supabase
        .from('leads')
        .insert(leadsToInsert);

      if (insertError) throw insertError;

      toast({
        title: 'Leads importados',
        description: `${selectedLeads.length} leads importados com sucesso.`,
      });

      onImportComplete();
      handleOpenChange(false);
    } catch (error: any) {
      toast({
        title: 'Erro ao importar',
        description: error.message || 'Não foi possível importar os leads',
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
    }
  }

  const canSearch = keywords.trim() || jobTitle.trim() || company.trim();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <svg className="h-5 w-5 text-[#0A66C2]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
            </svg>
            Buscar no LinkedIn
          </DialogTitle>
          <DialogDescription>
            {step === 'config' 
              ? 'Configure os filtros para buscar leads no LinkedIn.' 
              : `${results.length} resultados encontrados. Selecione os leads para importar.`}
          </DialogDescription>
        </DialogHeader>

        {step === 'config' ? (
          <div className="space-y-6 py-4">
            {/* Search filters */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="li-keywords">Palavras-chave</Label>
                <Input
                  id="li-keywords"
                  placeholder="Ex: marketing digital"
                  value={keywords}
                  onChange={e => setKeywords(e.target.value)}
                  disabled={isSearching}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="li-title">Cargo</Label>
                <Input
                  id="li-title"
                  placeholder="Ex: CEO, Diretor"
                  value={jobTitle}
                  onChange={e => setJobTitle(e.target.value)}
                  disabled={isSearching}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="li-company">Empresa</Label>
                <Input
                  id="li-company"
                  placeholder="Ex: Google, Microsoft"
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  disabled={isSearching}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="li-location">Localização</Label>
                <Input
                  id="li-location"
                  placeholder="Ex: São Paulo, Brasil"
                  value={locationFilter}
                  onChange={e => setLocationFilter(e.target.value)}
                  disabled={isSearching}
                />
              </div>
            </div>

            {/* Limit selector */}
            <div className="space-y-2">
              <Label>Quantidade por página</Label>
              <Select value={String(limit)} onValueChange={v => setLimit(Number(v))}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <div className="flex-1 space-y-4 py-4 overflow-hidden flex flex-col">
            {/* Results table */}
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep('config')}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Voltar
              </Button>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={selectedResults.size === results.length && results.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
                <span className="text-sm text-muted-foreground">
                  {selectedResults.size} de {results.length} selecionados
                </span>
              </div>
            </div>

            <ScrollArea className="flex-1 border rounded-lg">
              <div className="p-4 space-y-2">
                {results.map(result => (
                  <div
                    key={result.provider_id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedResults.has(result.provider_id)
                        ? 'bg-primary/10 border-primary'
                        : 'hover:bg-muted/50'
                    }`}
                    onClick={() => toggleSelect(result.provider_id)}
                  >
                    <Checkbox
                      checked={selectedResults.has(result.provider_id)}
                      onCheckedChange={() => toggleSelect(result.provider_id)}
                    />
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                      {result.profile_picture_url ? (
                        <img
                          src={result.profile_picture_url}
                          alt={result.full_name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <User className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">
                          {result.full_name || `${result.first_name} ${result.last_name}`}
                        </span>
                        {result.connection_degree && (
                          <Badge variant="secondary" className="text-xs">
                            {result.connection_degree}º
                          </Badge>
                        )}
                      </div>
                      {result.headline && (
                        <p className="text-sm text-muted-foreground truncate">
                          {result.headline}
                        </p>
                      )}
                      {result.location && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                          <MapPin className="h-3 w-3" />
                          <span>{result.location}</span>
                        </div>
                      )}
                    </div>
                    <a
                      href={result.profile_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-muted-foreground hover:text-primary"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                ))}

                {isLoadingMore && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Load more */}
            {hasMore && (
              <Button
                variant="outline"
                onClick={() => handleSearch(true)}
                disabled={isLoadingMore}
                className="w-full"
              >
                {isLoadingMore ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ChevronRight className="mr-2 h-4 w-4" />
                )}
                Carregar mais
              </Button>
            )}

            {/* List selection for import */}
            <div className="border-t pt-4 space-y-4">
              <Label className="text-base font-medium">Salvar em lista</Label>
              
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={listMode === 'new' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setListMode('new')}
                  className="flex-1"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Nova Lista
                </Button>
                <Button
                  type="button"
                  variant={listMode === 'existing' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setListMode('existing')}
                  className="flex-1"
                  disabled={lists.length === 0}
                >
                  <FolderOpen className="h-4 w-4 mr-1" />
                  Lista Existente
                </Button>
              </div>

              {listMode === 'new' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="new-list-name" className="text-sm">Nome *</Label>
                    <Input
                      id="new-list-name"
                      placeholder="Ex: Leads LinkedIn 2024"
                      value={newListName}
                      onChange={e => setNewListName(e.target.value)}
                      disabled={isImporting}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="new-list-desc" className="text-sm">Descrição</Label>
                    <Input
                      id="new-list-desc"
                      placeholder="Opcional"
                      value={newListDescription}
                      onChange={e => setNewListDescription(e.target.value)}
                      disabled={isImporting}
                    />
                  </div>
                </div>
              ) : (
                <Select value={selectedListId || ''} onValueChange={setSelectedListId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma lista" />
                  </SelectTrigger>
                  <SelectContent>
                    {lists.map(list => (
                      <SelectItem key={list.id} value={list.id}>
                        {list.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSearching || isImporting}
          >
            Cancelar
          </Button>

          {step === 'config' ? (
            <Button
              onClick={() => handleSearch(false)}
              disabled={!canSearch || isSearching}
            >
              {isSearching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Buscando...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Buscar
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={handleImport}
              disabled={selectedResults.size === 0 || isImporting}
            >
              {isImporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importando...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Importar {selectedResults.size} leads
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
