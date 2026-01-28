import { useState, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeads } from '@/hooks/useLeads';
import { useLeadLists } from '@/hooks/useLeadLists';
import { useCredits } from '@/hooks/useCredits';
import { useTags } from '@/hooks/useTags';
import { useWorkspacePlan } from '@/hooks/useWorkspacePlan';
import { useEnrichmentJobs } from '@/hooks/useEnrichmentJobs';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { LeadDetailsDrawer } from '@/components/leads/LeadDetailsDrawer';
import { LeadFilters } from '@/components/leads/LeadFilters';
import { MoveLeadsDialog } from '@/components/leads/MoveLeadsDialog';
import { DeleteLeadsDialog } from '@/components/leads/DeleteLeadsDialog';
import { DeepEnrichDialog } from '@/components/leads/DeepEnrichDialog';
import { LeadTagsPopover, LeadTagsBadges } from '@/components/leads/LeadTagsPopover';
import { BulkTagsPopover } from '@/components/leads/BulkTagsPopover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { 
  Phone, 
  Loader2, 
  Users, 
  Send,
  Download,
  RefreshCw,
  MapPin,
  Building2,
  Trash2,
  FolderInput,
  Tag,
  Linkedin,
  Sparkles,
  Brain,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { Lead, LeadFilters as LeadFiltersType } from '@/types';
import { useNavigate } from 'react-router-dom';

export default function Leads() {
  const { currentWorkspace } = useAuth();
  const { leads, isLoading, refetchLeads, deleteLeads, moveLeads } = useLeads();
  const { lists, createList } = useLeadLists();
  const { credits, refetchCredits } = useCredits();
  const { tags, refetchTags } = useTags();
  const { planLimits, usageToday, refetchUsage } = useWorkspacePlan();
  const { isLeadEnriching, refetch: refetchJobs } = useEnrichmentJobs();
  
  const { toast } = useToast();
  const navigate = useNavigate();

  // Selection state
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [enrichingLeads, setEnrichingLeads] = useState<Set<string>>(new Set());

  // Bulk enrichment state
  const [bulkEnriching, setBulkEnriching] = useState(false);
  const [bulkEnrichProgress, setBulkEnrichProgress] = useState({ current: 0, total: 0 });
  const [forceReEnrich, setForceReEnrich] = useState(false);

  // Details drawer state
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Get the selected lead from the leads array so it updates when refetched
  const selectedLead = useMemo(() => {
    if (!selectedLeadId) return null;
    return leads.find(l => l.id === selectedLeadId) || null;
  }, [selectedLeadId, leads]);

  // Filter state
  const [filters, setFilters] = useState<LeadFiltersType>({
    company: '',
    jobTitle: '',
    industry: '',
    country: '',
    listId: null,
    tagIds: [],
  });

  // Dialog states
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deepEnrichDialogOpen, setDeepEnrichDialogOpen] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Get lead tags helper from useTags
  const { getLeadTags } = useTags();

  // Filtered leads based on filter state
  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
      if (filters.company && !lead.company?.toLowerCase().includes(filters.company.toLowerCase())) {
        return false;
      }
      if (filters.jobTitle && !lead.job_title?.toLowerCase().includes(filters.jobTitle.toLowerCase())) {
        return false;
      }
      if (filters.industry && lead.industry !== filters.industry) {
        return false;
      }
      if (filters.country && lead.country !== filters.country) {
        return false;
      }
      if (filters.listId === 'no-list' && lead.list_id !== null) {
        return false;
      }
      if (filters.listId && filters.listId !== 'no-list' && lead.list_id !== filters.listId) {
        return false;
      }
      // Filter by tags
      if (filters.tagIds.length > 0) {
        const leadTagIds = getLeadTags(lead.id).map(t => t.id);
        const hasAllTags = filters.tagIds.every(tagId => leadTagIds.includes(tagId));
        if (!hasAllTags) return false;
      }
      return true;
    });
  }, [leads, filters, getLeadTags]);

  async function handleEnrichLead(lead: Lead) {
    if (!currentWorkspace || !lead.email) return;
    
    setEnrichingLeads(prev => new Set(prev).add(lead.id));
    
    try {
      const { data, error } = await supabase.functions.invoke('enrich-lead', {
        body: {
          workspaceId: currentWorkspace.id,
          email: lead.email,
          revealPhone: true,
        },
      });

      if (error) throw error;

      if (data.error?.includes('Insufficient') || data.error?.includes('créditos')) {
        toast({
          title: 'Créditos insuficientes',
          description: 'Você não tem créditos de telefone suficientes.',
          variant: 'destructive',
        });
        return;
      }

      if (data.success) {
        refetchLeads();
        refetchCredits();
        toast({
          title: 'Lead enriquecido',
          description: data.phone ? `Telefone encontrado: ${data.phone}` : 'Telefone não encontrado',
        });
      }
    } catch (error: any) {
      if (error.message?.includes('402') || error.message?.includes('créditos')) {
        toast({
          title: 'Créditos insuficientes',
          description: 'Você não tem créditos de telefone suficientes.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Erro ao enriquecer',
          description: error.message,
          variant: 'destructive',
        });
      }
    } finally {
      setEnrichingLeads(prev => {
        const next = new Set(prev);
        next.delete(lead.id);
        return next;
      });
    }
  }

  // Bulk enrich selected leads via LinkedIn (uses global platform account)
  async function handleBulkEnrich() {
    if (!currentWorkspace) return;
    
    // Filter leads with LinkedIn URL, optionally including already enriched
    const leadsToEnrich = leads.filter(
      l => selectedLeads.has(l.id) && l.linkedin_url && (forceReEnrich || !l.last_enriched_at)
    );
    
    if (leadsToEnrich.length === 0) {
      toast({
        title: 'Nenhum lead para enriquecer',
        description: forceReEnrich 
          ? 'Os leads selecionados não possuem URL do LinkedIn.'
          : 'Os leads selecionados já foram enriquecidos ou não possuem URL do LinkedIn.',
        variant: 'destructive',
      });
      return;
    }

    setBulkEnriching(true);
    setBulkEnrichProgress({ current: 0, total: leadsToEnrich.length });
    
    let successCount = 0;
    let errorCount = 0;
    let shouldStop = false;

    for (let i = 0; i < leadsToEnrich.length; i++) {
      if (shouldStop) break;
      
      const lead = leadsToEnrich[i];
      setBulkEnrichProgress({ current: i + 1, total: leadsToEnrich.length });
      
      try {
        const { data, error } = await supabase.functions.invoke('linkedin-enrich-lead', {
          body: {
            workspaceId: currentWorkspace.id,
            leadId: lead.id,
          },
        });

        if (error) throw error;
        if (data.error) {
          // Check if global account not configured
          if (data.error.includes('global') || data.error.includes('configurada')) {
            toast({
              title: 'Enriquecimento indisponível',
              description: 'Peça ao administrador para configurar a conta global do LinkedIn.',
              variant: 'destructive',
            });
            shouldStop = true;
            break;
          }
          throw new Error(data.error);
        }
        
        successCount++;
      } catch (error: any) {
        console.error(`Error enriching lead ${lead.id}:`, error);
        errorCount++;
        
        // Check for global config error
        if (error.message?.includes('global') || error.message?.includes('configurada')) {
          toast({
            title: 'Enriquecimento indisponível',
            description: 'Peça ao administrador para configurar a conta global do LinkedIn.',
            variant: 'destructive',
          });
          shouldStop = true;
          break;
        }
        
        // If we hit rate limit, stop processing
        if (error.message?.includes('rate') || error.message?.includes('limit')) {
          toast({
            title: 'Limite atingido',
            description: 'Limite diário de enriquecimento atingido. Tente novamente amanhã.',
            variant: 'destructive',
          });
          break;
        }
      }
      
      // Small delay between requests to avoid rate limiting
      if (i < leadsToEnrich.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    
    setBulkEnriching(false);
    setBulkEnrichProgress({ current: 0, total: 0 });
    refetchLeads();
    
    if (successCount > 0 || (!shouldStop && errorCount > 0)) {
      toast({
        title: 'Enriquecimento concluído',
        description: `${successCount} leads enriquecidos${errorCount > 0 ? `, ${errorCount} erros` : ''}.`,
      });
    }
  }

  function toggleSelectAll() {
    if (selectedLeads.size === filteredLeads.length) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(filteredLeads.map(l => l.id)));
    }
  }

  function toggleSelectLead(id: string) {
    const next = new Set(selectedLeads);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedLeads(next);
  }

  function exportCSV() {
    const selectedData = leads.filter(l => selectedLeads.has(l.id));
    const csv = [
      [
        'Nome', 'Email', 'Email Pessoal', 'Telefone', 'Celular', 'Empresa', 'Cargo', 
        'Headline', 'Nível', 'Indústria', 'Cidade', 'Estado', 'País', 'Website', 
        'Tamanho', 'Faturamento', 'LinkedIn', 'LinkedIn Empresa', 'Tecnologias', 'Keywords'
      ].join(','),
      ...selectedData.map(l => [
        l.full_name || '',
        l.email || '',
        l.personal_email || '',
        l.phone || '',
        l.mobile_number || '',
        l.company || '',
        l.job_title || '',
        l.headline || '',
        l.seniority_level || '',
        l.industry || '',
        l.city || '',
        l.state || '',
        l.country || '',
        l.company_website || '',
        l.company_size || '',
        l.company_annual_revenue || '',
        l.linkedin_url || '',
        l.company_linkedin || '',
        l.company_technologies || '',
        l.keywords || '',
      ].map(v => `"${(v || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leads.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCreateCampaign() {
    const selectedIds = Array.from(selectedLeads);
    navigate('/campaigns', { state: { selectedLeadIds: selectedIds } });
  }

  async function handleDeleteLeads() {
    setIsDeleting(true);
    try {
      await deleteLeads(Array.from(selectedLeads));
      setSelectedLeads(new Set());
      setDeleteDialogOpen(false);
      toast({
        title: 'Leads apagados',
        description: `${selectedLeads.size} leads foram apagados com sucesso.`,
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao apagar',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleMoveLeads(listId: string | null) {
    setIsMoving(true);
    try {
      await moveLeads({ leadIds: Array.from(selectedLeads), listId });
      setSelectedLeads(new Set());
      setMoveDialogOpen(false);
      toast({
        title: 'Leads movidos',
        description: `${selectedLeads.size} leads foram movidos com sucesso.`,
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao mover',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsMoving(false);
    }
  }

  function openLeadDetails(lead: Lead) {
    setSelectedLeadId(lead.id);
    setDrawerOpen(true);
  }

  function getLocation(lead: Lead) {
    const parts = [lead.city, lead.state, lead.country].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header with credits and LinkedIn Search CTA */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Leads</h1>
            <p className="text-muted-foreground">
              Gerencie seus leads e importe novos do LinkedIn
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={() => navigate('/linkedin/search')}
              className="bg-[#0A66C2] hover:bg-[#004182]"
            >
              <Linkedin className="mr-2 h-4 w-4" />
              Buscar no LinkedIn
            </Button>
            <Card className="px-4 py-2">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-primary" />
                <div className="text-sm">
                  <span className="font-semibold">{credits?.phone_credits || 0}</span>
                  <span className="text-muted-foreground ml-1">Phone</span>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* Lead Filters */}
        <LeadFilters
          filters={filters}
          onFiltersChange={setFilters}
          leads={leads}
          lists={lists}
          onCreateList={async (name, description) => {
            await createList({ name, description });
            toast({
              title: 'Lista criada',
              description: `Lista "${name}" criada com sucesso.`,
            });
          }}
        />

        {/* Leads Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle>Seus Leads</CardTitle>
                <Badge variant="secondary">{filteredLeads.length} leads</Badge>
                {filteredLeads.length !== leads.length && (
                  <Badge variant="outline">{leads.length} total</Badge>
                )}
              </div>
              <div className="flex gap-2">
                {selectedLeads.size > 0 && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleteDialogOpen(true)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Apagar ({selectedLeads.size})
                    </Button>
                    <BulkTagsPopover
                      selectedLeadIds={Array.from(selectedLeads)}
                      onComplete={() => {
                        refetchTags();
                        toast({
                          title: 'Tags aplicadas',
                          description: `Tags aplicadas em ${selectedLeads.size} leads.`,
                        });
                      }}
                    />
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={bulkEnriching}
                        >
                          {bulkEnriching ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              {bulkEnrichProgress.current}/{bulkEnrichProgress.total}
                            </>
                          ) : (
                            <>
                              <Sparkles className="mr-2 h-4 w-4 text-primary" />
                              Enriquecer LinkedIn
                            </>
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72" align="end">
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <h4 className="font-medium text-sm">Enriquecer via LinkedIn</h4>
                            <p className="text-xs text-muted-foreground">
                              Busca dados adicionais dos leads selecionados que possuem perfil LinkedIn.
                            </p>
                          </div>
                          {bulkEnriching ? (
                            <div className="space-y-2">
                              <Progress 
                                value={(bulkEnrichProgress.current / bulkEnrichProgress.total) * 100} 
                              />
                              <p className="text-xs text-muted-foreground text-center">
                                Enriquecendo {bulkEnrichProgress.current} de {bulkEnrichProgress.total}...
                              </p>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center justify-between">
                                <Label className="text-xs">Re-enriquecer já enriquecidos</Label>
                                <Switch 
                                  checked={forceReEnrich} 
                                  onCheckedChange={setForceReEnrich}
                                />
                              </div>
                              <Button
                                className="w-full"
                                size="sm"
                                onClick={handleBulkEnrich}
                              >
                                <Linkedin className="mr-2 h-4 w-4" />
                                Enriquecer {selectedLeads.size} leads
                              </Button>
                            </>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setDeepEnrichDialogOpen(true)}
                          >
                            <Brain className="mr-2 h-4 w-4" />
                            Enrich Deep
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p className="font-medium">Enriquecimento profundo via LinkedIn</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Histórico completo de carreira, skills, educação e conexões. 
                            Consome créditos premium.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setMoveDialogOpen(true)}
                    >
                      <FolderInput className="mr-2 h-4 w-4" />
                      Mover
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportCSV}>
                      <Download className="mr-2 h-4 w-4" />
                      Exportar ({selectedLeads.size})
                    </Button>
                    <Button size="sm" onClick={handleCreateCampaign}>
                      <Send className="mr-2 h-4 w-4" />
                      Criar Campanha
                    </Button>
                  </>
                )}
                <Button variant="outline" size="icon" onClick={refetchLeads}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filteredLeads.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Nenhum lead encontrado.</p>
                <p className="text-sm">
                  {leads.length > 0
                    ? 'Tente ajustar os filtros.'
                    : 'Clique em "Buscar no LinkedIn" para importar leads.'}
                </p>
                {leads.length === 0 && (
                  <Button
                    onClick={() => navigate('/linkedin/search')}
                    className="mt-4 bg-[#0A66C2] hover:bg-[#004182]"
                  >
                    <Linkedin className="mr-2 h-4 w-4" />
                    Buscar no LinkedIn
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={selectedLeads.size === filteredLeads.length && filteredLeads.length > 0}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Tags</TableHead>
                      <TableHead>Empresa</TableHead>
                      <TableHead>Cargo</TableHead>
                      <TableHead>Indústria</TableHead>
                      <TableHead>Localização</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Celular</TableHead>
                      <TableHead>LinkedIn</TableHead>
                      <TableHead className="w-32">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLeads.map((lead) => (
                      <TableRow 
                        key={lead.id} 
                        className="group cursor-pointer hover:bg-muted/50"
                        onClick={() => openLeadDetails(lead)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedLeads.has(lead.id)}
                            onCheckedChange={() => toggleSelectLead(lead.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <span>{lead.full_name || '-'}</span>
                              {isLeadEnriching(lead.id) ? (
                                <Badge variant="secondary" className="text-xs gap-1 px-1.5 py-0">
                                  <Brain className="h-3 w-3 animate-pulse" />
                                  Enriquecendo...
                                </Badge>
                              ) : lead.last_enriched_at && (
                                <span title="Enriquecido"><Sparkles className="h-3 w-3 text-primary" /></span>
                              )}
                            </div>
                            {lead.headline && (
                              <span className="text-xs text-muted-foreground truncate max-w-[250px]">
                                {lead.headline}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <LeadTagsBadges leadId={lead.id} />
                            <LeadTagsPopover leadId={lead.id}>
                              <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Tag className="h-3.5 w-3.5" />
                              </Button>
                            </LeadTagsPopover>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span className="truncate max-w-[150px]">{lead.company || '-'}</span>
                            </div>
                            {(lead.company_size || lead.company_industry) && (
                              <div className="flex flex-wrap gap-1">
                                {lead.company_size && (
                                  <Badge variant="outline" className="text-xs py-0">
                                    {lead.company_size}
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="truncate max-w-[150px]">{lead.job_title || '-'}</span>
                            {lead.seniority_level && (
                              <Badge variant="secondary" className="w-fit text-xs py-0">
                                {lead.seniority_level}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm truncate max-w-[120px] block">
                            {lead.industry || lead.company_industry || '-'}
                          </span>
                        </TableCell>
                        <TableCell>
                          {getLocation(lead) ? (
                            <div className="flex items-center gap-1 text-sm">
                              <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span className="truncate max-w-[130px]">{getLocation(lead)}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {lead.email ? (
                            <span className="text-sm truncate max-w-[150px] block">{lead.email}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {lead.mobile_number || lead.phone ? (
                            <Badge variant="secondary" className="gap-1">
                              <Phone className="h-3 w-3" />
                              {lead.mobile_number || lead.phone}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {lead.linkedin_url ? (
                            <a
                              href={lead.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline inline-flex items-center gap-1"
                            >
                              <Linkedin className="h-3.5 w-3.5" />
                              Perfil
                            </a>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {!lead.phone && !lead.mobile_number && lead.email && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEnrichLead(lead)}
                              disabled={enrichingLeads.has(lead.id)}
                            >
                              {enrichingLeads.has(lead.id) ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Phone className="mr-1 h-3 w-3" />
                                  Enriquecer
                                </>
                              )}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Lead Details Drawer */}
      <LeadDetailsDrawer
        lead={selectedLead}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        workspaceId={currentWorkspace?.id}
        onLeadUpdated={refetchLeads}
      />

      {/* Move Leads Dialog */}
      <MoveLeadsDialog
        open={moveDialogOpen}
        onOpenChange={setMoveDialogOpen}
        onConfirm={handleMoveLeads}
        lists={lists}
        selectedCount={selectedLeads.size}
        isLoading={isMoving}
      />

      {/* Delete Leads Dialog */}
      <DeleteLeadsDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDeleteLeads}
        selectedCount={selectedLeads.size}
        isLoading={isDeleting}
      />

      {/* Deep Enrich Dialog */}
      <DeepEnrichDialog
        open={deepEnrichDialogOpen}
        onOpenChange={setDeepEnrichDialogOpen}
        selectedLeads={leads.filter(l => selectedLeads.has(l.id))}
        workspaceId={currentWorkspace?.id || ''}
        dailyLimit={(planLimits as any)?.daily_enrich_deep_limit || 10}
        usedToday={usageToday?.linkedin_enrich_deep || 0}
        onSuccess={() => {
          setSelectedLeads(new Set());
          refetchJobs();
          refetchUsage();
          // Start polling leads to see updated data
          setTimeout(() => refetchLeads(), 5000);
        }}
      />
    </AppLayout>
  );
}
