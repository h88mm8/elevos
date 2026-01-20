import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCampaigns } from '@/hooks/useCampaigns';
import { useLeads } from '@/hooks/useLeads';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  Send, 
  Plus, 
  Loader2,
  Mail,
  MessageCircle,
  Linkedin,
  Calendar
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Lead } from '@/types';

const statusLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: 'Rascunho', variant: 'secondary' },
  scheduled: { label: 'Agendada', variant: 'outline' },
  running: { label: 'Enviando', variant: 'default' },
  paused: { label: 'Pausada', variant: 'secondary' },
  completed: { label: 'Concluída', variant: 'default' },
  failed: { label: 'Falhou', variant: 'destructive' },
};

const typeIcons: Record<string, React.ElementType> = {
  email: Mail,
  whatsapp: MessageCircle,
  linkedin: Linkedin,
};

const typeLabels: Record<string, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  linkedin: 'LinkedIn',
};

export default function Campaigns() {
  const { currentWorkspace } = useAuth();
  const { campaigns, isLoading, createCampaign, refetchCampaigns } = useCampaigns();
  const { leads } = useLeads();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [type, setType] = useState<'email' | 'whatsapp' | 'linkedin'>('email');
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());

  // Filter leads based on campaign type
  const validLeads = leads.filter(lead => {
    if (type === 'email') return !!lead.email;
    if (type === 'whatsapp') return !!lead.phone;
    if (type === 'linkedin') return !!lead.linkedin_url;
    return false;
  });

  function resetForm() {
    setName('');
    setType('email');
    setMessage('');
    setSubject('');
    setSelectedLeadIds(new Set());
  }

  async function handleCreateCampaign() {
    if (!currentWorkspace || !name || !message || selectedLeadIds.size === 0) {
      toast({
        title: 'Campos obrigatórios',
        description: 'Preencha todos os campos e selecione pelo menos 1 lead.',
        variant: 'destructive',
      });
      return;
    }

    setCreating(true);
    try {
      const selectedLeadsData = leads.filter(l => selectedLeadIds.has(l.id));
      
      const { data, error } = await supabase.functions.invoke('create-campaign', {
        body: {
          workspaceId: currentWorkspace.id,
          name,
          type,
          message,
          subject: type === 'email' ? subject : undefined,
          leads: selectedLeadsData.map(l => ({
            email: l.email,
            full_name: l.full_name,
            phone: l.phone,
            linkedin_url: l.linkedin_url,
          })),
        },
      });

      if (error) throw error;

      toast({
        title: 'Campanha criada',
        description: `Campanha "${name}" criada com ${selectedLeadIds.size} leads.`,
      });

      refetchCampaigns();
      setDialogOpen(false);
      resetForm();
    } catch (error: any) {
      toast({
        title: 'Erro ao criar campanha',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  }

  function toggleLeadSelection(leadId: string) {
    const next = new Set(selectedLeadIds);
    if (next.has(leadId)) {
      next.delete(leadId);
    } else {
      next.add(leadId);
    }
    setSelectedLeadIds(next);
  }

  function toggleSelectAllLeads() {
    if (selectedLeadIds.size === validLeads.length) {
      setSelectedLeadIds(new Set());
    } else {
      setSelectedLeadIds(new Set(validLeads.map(l => l.id)));
    }
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Campanhas</h1>
            <p className="text-muted-foreground">
              Crie e gerencie suas campanhas de outreach
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nova Campanha
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Criar Nova Campanha</DialogTitle>
                <DialogDescription>
                  Configure sua campanha de outreach
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nome da Campanha</Label>
                    <Input
                      id="name"
                      placeholder="Ex: Prospecção Janeiro"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="type">Tipo</Label>
                    <Select value={type} onValueChange={(v: 'email' | 'whatsapp' | 'linkedin') => setType(v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="email">
                          <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4" />
                            Email
                          </div>
                        </SelectItem>
                        <SelectItem value="whatsapp">
                          <div className="flex items-center gap-2">
                            <MessageCircle className="h-4 w-4" />
                            WhatsApp
                          </div>
                        </SelectItem>
                        <SelectItem value="linkedin">
                          <div className="flex items-center gap-2">
                            <Linkedin className="h-4 w-4" />
                            LinkedIn
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {type === 'email' && (
                  <div className="space-y-2">
                    <Label htmlFor="subject">Assunto</Label>
                    <Input
                      id="subject"
                      placeholder="Assunto do email"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="message">Mensagem</Label>
                  <Textarea
                    id="message"
                    placeholder="Escreva sua mensagem..."
                    rows={5}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use {"{{nome}}"} para personalizar com o nome do lead
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Selecionar Leads ({selectedLeadIds.size} de {validLeads.length})</Label>
                    {validLeads.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={toggleSelectAllLeads}>
                        {selectedLeadIds.size === validLeads.length ? 'Desmarcar todos' : 'Selecionar todos'}
                      </Button>
                    )}
                  </div>
                  
                  {validLeads.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground border rounded-lg">
                      <p>Nenhum lead válido para {typeLabels[type]}.</p>
                      <p className="text-sm">Importe ou busque leads primeiro.</p>
                    </div>
                  ) : (
                    <div className="border rounded-lg max-h-48 overflow-y-auto">
                      {validLeads.map(lead => (
                        <label
                          key={lead.id}
                          className="flex items-center gap-3 p-3 hover:bg-muted cursor-pointer border-b last:border-b-0"
                        >
                          <Checkbox
                            checked={selectedLeadIds.has(lead.id)}
                            onCheckedChange={() => toggleLeadSelection(lead.id)}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{lead.full_name || 'Sem nome'}</p>
                            <p className="text-sm text-muted-foreground truncate">
                              {type === 'email' ? lead.email : type === 'whatsapp' ? lead.phone : lead.linkedin_url}
                            </p>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleCreateCampaign} disabled={creating}>
                  {creating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Criando...
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      Criar Campanha
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Campaigns List */}
        <Card>
          <CardHeader>
            <CardTitle>Suas Campanhas</CardTitle>
            <CardDescription>
              {campaigns.length} campanhas criadas
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : campaigns.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Send className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Nenhuma campanha criada ainda.</p>
                <p className="text-sm">Clique em "Nova Campanha" para começar.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Enviadas</TableHead>
                    <TableHead className="text-right">Falhas</TableHead>
                    <TableHead className="text-right">Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((campaign) => {
                    const TypeIcon = typeIcons[campaign.type] || Mail;
                    return (
                      <TableRow key={campaign.id}>
                        <TableCell className="font-medium">{campaign.name}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <TypeIcon className="h-4 w-4" />
                            {typeLabels[campaign.type]}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusLabels[campaign.status]?.variant || 'secondary'}>
                            {statusLabels[campaign.status]?.label || campaign.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{campaign.leads_count}</TableCell>
                        <TableCell className="text-right">{campaign.sent_count}</TableCell>
                        <TableCell className="text-right">
                          {campaign.failed_count > 0 && (
                            <span className="text-destructive">{campaign.failed_count}</span>
                          )}
                          {campaign.failed_count === 0 && '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {format(new Date(campaign.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
