import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeads } from '@/hooks/useLeads';
import { useCredits } from '@/hooks/useCredits';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  Search, 
  Phone, 
  Loader2, 
  Users, 
  ExternalLink,
  Send,
  Download,
  RefreshCw,
} from 'lucide-react';
import { Lead } from '@/types';
import { useNavigate } from 'react-router-dom';

export default function Leads() {
  const { currentWorkspace } = useAuth();
  const { leads, isLoading, refetchLeads } = useLeads();
  const { credits, refetchCredits } = useCredits();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Search form state
  const [jobTitle, setJobTitle] = useState('');
  const [company, setCompany] = useState('');
  const [country, setCountry] = useState('');
  const [location, setLocation] = useState('');
  const [fetchCount, setFetchCount] = useState(50);
  const [onlyWithEmail, setOnlyWithEmail] = useState(true);
  const [searching, setSearching] = useState(false);
  const [pollingRunId, setPollingRunId] = useState<string | null>(null);

  // Progress state for partial results
  const [searchProgress, setSearchProgress] = useState({
    itemsProcessed: 0,
    totalItems: 0,
  });
  const [partialCount, setPartialCount] = useState(0);

  // Selection state
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [enrichingLeads, setEnrichingLeads] = useState<Set<string>>(new Set());

  async function handleSearch() {
    if (!currentWorkspace) return;
    
    setSearching(true);
    setSearchProgress({ itemsProcessed: 0, totalItems: 0 });
    setPartialCount(0);
    
    try {
      const { data, error } = await supabase.functions.invoke('search-leads', {
        body: {
          workspaceId: currentWorkspace.id,
          filters: {
            job_title: jobTitle || undefined,
            company_domain: company || undefined,
            country: country || undefined,
            location: location || undefined,
          },
          fetch_count: fetchCount,
          onlyWithEmail,
        },
      });

      if (error) throw error;

      // Check for 402 insufficient credits
      if (data.error?.includes('Insufficient') || data.error?.includes('créditos')) {
        toast({
          title: 'Créditos insuficientes',
          description: 'Você não tem créditos de leads suficientes para esta busca.',
          variant: 'destructive',
        });
        setSearching(false);
        return;
      }

      if (data.success && data.runId) {
        setPollingRunId(data.runId);
        toast({
          title: 'Busca iniciada',
          description: 'Aguarde enquanto buscamos os leads...',
        });
        pollForResults(data.runId);
      } else {
        throw new Error(data.message || data.error || 'Erro ao iniciar busca');
      }
    } catch (error: any) {
      // Handle 402 from edge function
      if (error.message?.includes('402') || error.message?.includes('créditos')) {
        toast({
          title: 'Créditos insuficientes',
          description: 'Você não tem créditos de leads suficientes para esta busca.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Erro na busca',
          description: error.message || 'Não foi possível buscar leads',
          variant: 'destructive',
        });
      }
      setSearching(false);
    }
  }

  async function pollForResults(runId: string) {
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes with 5 second intervals
    
    const poll = async () => {
      if (attempts >= maxAttempts) {
        setSearching(false);
        setPollingRunId(null);
        setSearchProgress({ itemsProcessed: 0, totalItems: 0 });
        setPartialCount(0);
        toast({
          title: 'Timeout',
          description: 'A busca demorou muito. Tente novamente.',
          variant: 'destructive',
        });
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke('get-leads-results', {
          body: {
            workspaceId: currentWorkspace?.id,
            runId,
            onlyWithEmail,
            fetchCount, // Pass limit to backend
          },
        });

        if (error) throw error;

        // Update progress from response
        if (data.progress) {
          setSearchProgress({
            totalItems: data.progress.totalItems || 0,
            itemsProcessed: data.progress.itemsProcessed || 0,
          });
        }

        // Update partial count and refetch if leads available
        if (data.leadsCount > 0) {
          setPartialCount(data.leadsCount);
          refetchLeads();
        }

        if (data.status === 'SUCCEEDED') {
          // Search completed - stop polling
          setSearching(false);
          setPollingRunId(null);
          setSearchProgress({ itemsProcessed: 0, totalItems: 0 });
          setPartialCount(0);
          refetchLeads();
          refetchCredits();
          toast({
            title: 'Busca concluída',
            description: `${data.leadsCount || 0} leads encontrados`,
          });
        } else if (data.status === 'FAILED' || data.status === 'ABORTED') {
          throw new Error('A busca falhou');
        } else if (data.leadsCount >= fetchCount) {
          // Reached requested limit - stop even if RUNNING
          setSearching(false);
          setPollingRunId(null);
          setSearchProgress({ itemsProcessed: 0, totalItems: 0 });
          setPartialCount(0);
          refetchLeads();
          refetchCredits();
          toast({
            title: 'Busca concluída',
            description: `${data.leadsCount} leads encontrados (limite atingido)`,
          });
        } else {
          // Still running - continue polling
          attempts++;
          setTimeout(poll, 5000);
        }
      } catch (error: any) {
        setSearching(false);
        setPollingRunId(null);
        setSearchProgress({ itemsProcessed: 0, totalItems: 0 });
        setPartialCount(0);
        toast({
          title: 'Erro ao buscar resultados',
          description: error.message,
          variant: 'destructive',
        });
      }
    };

    poll();
  }

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

      // Check for 402 insufficient credits
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

  function toggleSelectAll() {
    if (selectedLeads.size === leads.length) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(leads.map(l => l.id)));
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
      ['Nome', 'Email', 'Telefone', 'Empresa', 'Cargo', 'LinkedIn'].join(','),
      ...selectedData.map(l => [
        l.full_name || '',
        l.email || '',
        l.phone || '',
        l.company || '',
        l.job_title || '',
        l.linkedin_url || '',
      ].map(v => `"${v}"`).join(','))
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
    // Navigate to campaigns with selected leads
    const selectedIds = Array.from(selectedLeads);
    navigate('/campaigns', { state: { selectedLeadIds: selectedIds } });
  }

  const progressPercent = searchProgress.totalItems > 0
    ? Math.min(100, Math.round((searchProgress.itemsProcessed / searchProgress.totalItems) * 100))
    : 0;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header with credits */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Leads</h1>
            <p className="text-muted-foreground">
              Busque e gerencie seus leads
            </p>
          </div>
          <div className="flex gap-3">
            <Card className="px-4 py-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <div className="text-sm">
                  <span className="font-semibold">{credits?.leads_credits || 0}</span>
                  <span className="text-muted-foreground ml-1">Leads</span>
                </div>
              </div>
            </Card>
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

        {/* Active Search Banner with Progress */}
        {searching && (
          <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <div>
                  <p className="font-medium">Buscando leads...</p>
                  <p className="text-sm text-muted-foreground">
                    {partialCount > 0
                      ? `${partialCount} leads encontrados até agora`
                      : 'Aguardando resultados...'}
                  </p>
                </div>
              </div>
            </div>
            
            {/* Progress bar */}
            <div className="space-y-1">
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-right">
                {searchProgress.totalItems > 0
                  ? `${searchProgress.itemsProcessed} / ${searchProgress.totalItems} processados`
                  : 'Estimando progresso...'}
              </p>
            </div>
          </div>
        )}

        {/* Search Form */}
        <Card>
          <CardHeader>
            <CardTitle>Buscar Leads</CardTitle>
            <CardDescription>
              Use os filtros para encontrar leads qualificados
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-2">
                <Label htmlFor="jobTitle">Cargo</Label>
                <Input
                  id="jobTitle"
                  placeholder="Ex: CEO, CTO, Diretor"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  disabled={searching}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company">Empresa / Domínio</Label>
                <Input
                  id="company"
                  placeholder="Ex: empresa.com"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  disabled={searching}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="country">País</Label>
                <Input
                  id="country"
                  placeholder="Ex: Brazil"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  disabled={searching}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Localização</Label>
                <Input
                  id="location"
                  placeholder="Ex: São Paulo"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  disabled={searching}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fetchCount">Quantidade</Label>
                <Input
                  id="fetchCount"
                  type="number"
                  min={1}
                  max={100}
                  value={fetchCount}
                  onChange={(e) => setFetchCount(parseInt(e.target.value) || 50)}
                  disabled={searching}
                />
              </div>
            </div>
            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="onlyWithEmail"
                  checked={onlyWithEmail}
                  onCheckedChange={setOnlyWithEmail}
                  disabled={searching}
                />
                <Label htmlFor="onlyWithEmail" className="cursor-pointer">
                  Apenas com email válido
                </Label>
              </div>
              <Button onClick={handleSearch} disabled={searching}>
                {searching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Buscando...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Buscar Leads
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Leads Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CardTitle>Seus Leads</CardTitle>
                <Badge variant="secondary">{leads.length} leads</Badge>
              </div>
              <div className="flex gap-2">
                {selectedLeads.size > 0 && (
                  <>
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
            ) : leads.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Nenhum lead encontrado.</p>
                <p className="text-sm">Use o formulário acima para buscar leads.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedLeads.size === leads.length && leads.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Cargo</TableHead>
                    <TableHead>LinkedIn</TableHead>
                    <TableHead className="w-24">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((lead) => (
                    <TableRow key={lead.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedLeads.has(lead.id)}
                          onCheckedChange={() => toggleSelectLead(lead.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {lead.full_name || '-'}
                      </TableCell>
                      <TableCell>
                        {lead.email ? (
                          <span className="text-sm">{lead.email}</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {lead.phone ? (
                          <Badge variant="secondary">{lead.phone}</Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>{lead.company || '-'}</TableCell>
                      <TableCell>{lead.job_title || '-'}</TableCell>
                      <TableCell>
                        {lead.linkedin_url ? (
                          <a
                            href={lead.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Perfil
                          </a>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {!lead.phone && lead.email && (
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
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}