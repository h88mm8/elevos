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
  RefreshCw
} from 'lucide-react';
import { Lead } from '@/types';

export default function Leads() {
  const { currentWorkspace, session } = useAuth();
  const { leads, isLoading, refetchLeads } = useLeads();
  const { credits, refetchCredits } = useCredits();
  const { toast } = useToast();

  // Search form state
  const [jobTitle, setJobTitle] = useState('');
  const [company, setCompany] = useState('');
  const [country, setCountry] = useState('');
  const [fetchCount, setFetchCount] = useState(10);
  const [onlyWithEmail, setOnlyWithEmail] = useState(true);
  const [searching, setSearching] = useState(false);
  const [pollingRunId, setPollingRunId] = useState<string | null>(null);

  // Selection state
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [enrichingLeads, setEnrichingLeads] = useState<Set<string>>(new Set());

  async function handleSearch() {
    if (!currentWorkspace) return;
    
    setSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('search-leads', {
        body: {
          workspaceId: currentWorkspace.id,
          filters: {
            job_title: jobTitle || undefined,
            company: company || undefined,
            country: country || undefined,
          },
          fetch_count: fetchCount,
          onlyWithEmail,
        },
      });

      if (error) throw error;

      if (data.success && data.runId) {
        setPollingRunId(data.runId);
        toast({
          title: 'Busca iniciada',
          description: 'Aguarde enquanto buscamos os leads...',
        });
        pollForResults(data.runId);
      } else {
        throw new Error(data.message || 'Erro ao iniciar busca');
      }
    } catch (error: any) {
      toast({
        title: 'Erro na busca',
        description: error.message || 'Não foi possível buscar leads',
        variant: 'destructive',
      });
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
          },
        });

        if (error) throw error;

        if (data.status === 'SUCCEEDED') {
          setSearching(false);
          setPollingRunId(null);
          refetchLeads();
          refetchCredits();
          toast({
            title: 'Busca concluída',
            description: `${data.leadsCount || 0} leads encontrados`,
          });
        } else if (data.status === 'FAILED') {
          throw new Error('A busca falhou');
        } else {
          // Still running, poll again
          attempts++;
          setTimeout(poll, 5000);
        }
      } catch (error: any) {
        setSearching(false);
        setPollingRunId(null);
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

      if (data.success) {
        refetchLeads();
        refetchCredits();
        toast({
          title: 'Lead enriquecido',
          description: data.phone ? `Telefone encontrado: ${data.phone}` : 'Telefone não encontrado',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Erro ao enriquecer',
        description: error.message,
        variant: 'destructive',
      });
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

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Leads</h1>
            <p className="text-muted-foreground">
              Busque e gerencie seus leads
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>{credits?.leads_credits || 0} créditos</span>
            <Phone className="h-4 w-4 ml-2" />
            <span>{credits?.phone_credits || 0} créditos</span>
          </div>
        </div>

        {/* Search Form */}
        <Card>
          <CardHeader>
            <CardTitle>Buscar Leads</CardTitle>
            <CardDescription>
              Use os filtros para encontrar leads qualificados
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="jobTitle">Cargo</Label>
                <Input
                  id="jobTitle"
                  placeholder="Ex: CEO, CTO, Diretor"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company">Empresa</Label>
                <Input
                  id="company"
                  placeholder="Nome da empresa"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="country">País</Label>
                <Input
                  id="country"
                  placeholder="Ex: Brasil"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
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
                  onChange={(e) => setFetchCount(parseInt(e.target.value) || 10)}
                />
              </div>
            </div>
            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="onlyWithEmail"
                  checked={onlyWithEmail}
                  onCheckedChange={setOnlyWithEmail}
                />
                <Label htmlFor="onlyWithEmail">Apenas com email válido</Label>
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
              <div>
                <CardTitle>Seus Leads</CardTitle>
                <CardDescription>
                  {leads.length} leads encontrados
                </CardDescription>
              </div>
              <div className="flex gap-2">
                {selectedLeads.size > 0 && (
                  <>
                    <Button variant="outline" size="sm" onClick={exportCSV}>
                      <Download className="mr-2 h-4 w-4" />
                      Exportar ({selectedLeads.size})
                    </Button>
                    <Button size="sm">
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
                        checked={selectedLeads.size === leads.length}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Cargo</TableHead>
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
                      <TableCell>{lead.email || '-'}</TableCell>
                      <TableCell>
                        {lead.phone ? (
                          <Badge variant="secondary">{lead.phone}</Badge>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEnrichLead(lead)}
                            disabled={enrichingLeads.has(lead.id) || !lead.email}
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
                      <TableCell>{lead.company || '-'}</TableCell>
                      <TableCell>{lead.job_title || '-'}</TableCell>
                      <TableCell>
                        {lead.linkedin_url && (
                          <a
                            href={lead.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
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
