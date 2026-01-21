import { useState, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCampaigns } from '@/hooks/useCampaigns';
import { useLeads } from '@/hooks/useLeads';
import { useAccounts } from '@/hooks/useAccounts';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  Send, 
  Plus, 
  Loader2,
  Mail,
  MessageCircle,
  Linkedin,
  Calendar,
  AlertCircle,
  Variable,
  Eye,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Lead } from '@/types';
import { MESSAGE_VARIABLES, getMessagePreview } from '@/lib/messageVariables';

const statusLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: 'Rascunho', variant: 'secondary' },
  scheduled: { label: 'Agendada', variant: 'outline' },
  sending: { label: 'Enviando...', variant: 'default' },
  running: { label: 'Enviando', variant: 'default' },
  paused: { label: 'Pausada', variant: 'secondary' },
  completed: { label: 'Concluída', variant: 'default' },
  partial: { label: 'Parcial', variant: 'outline' },
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
  const { accounts } = useAccounts();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [sendingCampaignId, setSendingCampaignId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Form state
  const [name, setName] = useState('');
  const [type, setType] = useState<'email' | 'whatsapp' | 'linkedin'>('email');
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());

  // Filter accounts by campaign type
  const channelAccounts = useMemo(() => {
    const channelMap: Record<string, string> = {
      whatsapp: 'whatsapp',
      linkedin: 'linkedin',
      email: 'email',
    };
    return accounts.filter(
      acc => acc.channel === channelMap[type] && acc.status === 'connected'
    );
  }, [accounts, type]);

  // Check if account is required (WhatsApp and LinkedIn need an account)
  const requiresAccount = type === 'whatsapp' || type === 'linkedin';

  // Filter leads based on campaign type
  const validLeads = leads.filter(lead => {
    if (type === 'email') return !!lead.email;
    if (type === 'whatsapp') return !!lead.mobile_number;
    if (type === 'linkedin') return !!lead.linkedin_url;
    return false;
  });

  function resetForm() {
    setName('');
    setType('email');
    setMessage('');
    setSubject('');
    setSelectedAccountId('');
    setSelectedLeadIds(new Set());
    setShowPreview(false);
  }

  function insertVariable(variable: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      setMessage(prev => prev + variable);
      return;
    }
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newValue = message.substring(0, start) + variable + message.substring(end);
    setMessage(newValue);
    
    // Set cursor position after inserted variable
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + variable.length, start + variable.length);
    }, 0);
  }

  // Reset account when type changes
  function handleTypeChange(newType: 'email' | 'whatsapp' | 'linkedin') {
    setType(newType);
    setSelectedAccountId('');
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

    // Validate account selection for WhatsApp/LinkedIn
    if (requiresAccount && !selectedAccountId) {
      toast({
        title: 'Conta obrigatória',
        description: `Selecione uma conta de ${typeLabels[type]} para enviar a campanha.`,
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
          accountId: selectedAccountId || undefined,
          leads: selectedLeadsData.map(l => ({
            id: l.id,
            email: l.email,
            full_name: l.full_name,
            phone: l.phone,
            mobile_number: l.mobile_number,
            linkedin_url: l.linkedin_url,
            company: l.company,
            job_title: l.job_title,
            country: l.country,
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

  async function handleSendCampaign(campaignId: string) {
    if (!currentWorkspace) return;
    
    setSendingCampaignId(campaignId);
    
    try {
      const { data, error } = await supabase.functions.invoke('send-campaign', {
        body: { campaignId },
      });

      if (error) throw error;

      toast({
        title: 'Campanha enviada',
        description: `${data.sentCount} mensagens enviadas, ${data.failedCount} falhas.`,
      });

      refetchCampaigns();
    } catch (error: any) {
      toast({
        title: 'Erro ao enviar campanha',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSendingCampaignId(null);
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
                    <Select value={type} onValueChange={(v: 'email' | 'whatsapp' | 'linkedin') => handleTypeChange(v)}>
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

                {/* Account selection for WhatsApp/LinkedIn */}
                {requiresAccount && (
                  <div className="space-y-2">
                    <Label htmlFor="account">
                      Conta de {typeLabels[type]} *
                    </Label>
                    {channelAccounts.length === 0 ? (
                      <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/50 text-sm text-muted-foreground">
                        <AlertCircle className="h-4 w-4 text-amber-500" />
                        <span>
                          Nenhuma conta de {typeLabels[type]} conectada. 
                          Vá em Configurações {'>'} Integrações para sincronizar contas.
                        </span>
                      </div>
                    ) : (
                      <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione uma conta..." />
                        </SelectTrigger>
                        <SelectContent>
                          {channelAccounts.map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              <div className="flex items-center gap-2">
                                {type === 'whatsapp' ? (
                                  <MessageCircle className="h-4 w-4" />
                                ) : (
                                  <Linkedin className="h-4 w-4" />
                                )}
                                {account.name || account.account_id.slice(0, 12)}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}

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
                  <div className="flex items-center justify-between">
                    <Label htmlFor="message">Mensagem</Label>
                    <div className="flex items-center gap-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="h-7 gap-1">
                            <Variable className="h-3.5 w-3.5" />
                            Variável
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 p-2" align="end">
                          <div className="grid gap-1">
                            {MESSAGE_VARIABLES.map((variable) => (
                              <button
                                key={variable.variable}
                                onClick={() => insertVariable(variable.variable)}
                                className="flex items-center justify-between w-full px-2 py-1.5 text-left text-sm rounded hover:bg-muted"
                              >
                                <span>{variable.label}</span>
                                <code className="text-xs text-muted-foreground font-mono">
                                  {variable.variable}
                                </code>
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1"
                        onClick={() => setShowPreview(!showPreview)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        {showPreview ? 'Editar' : 'Preview'}
                      </Button>
                    </div>
                  </div>
                  
                  {showPreview ? (
                    <div className="p-4 border rounded-lg bg-muted/30 min-h-[130px]">
                      <p className="text-sm whitespace-pre-wrap">
                        {getMessagePreview(message)}
                      </p>
                    </div>
                  ) : (
                    <Textarea
                      ref={textareaRef}
                      id="message"
                      placeholder="Escreva sua mensagem... Use variáveis como {{primeiro_nome}} para personalizar"
                      rows={5}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                  )}
                  
                  <div className="flex flex-wrap gap-1">
                    {['{{primeiro_nome}}', '{{empresa}}', '{{cargo}}'].map((v) => (
                      <Badge
                        key={v}
                        variant="outline"
                        className="cursor-pointer hover:bg-muted text-xs"
                        onClick={() => insertVariable(v)}
                      >
                        {v}
                      </Badge>
                    ))}
                    <span className="text-xs text-muted-foreground self-center ml-1">
                      Clique para inserir
                    </span>
                  </div>
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
                    <TableHead className="text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((campaign) => {
                    const TypeIcon = typeIcons[campaign.type] || Mail;
                    const canSend = campaign.status === 'draft' || campaign.status === 'partial' || campaign.status === 'failed';
                    const isSending = sendingCampaignId === campaign.id || campaign.status === 'sending';
                    
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
                        <TableCell className="text-center">
                          {canSend && (
                            <Button
                              size="sm"
                              onClick={() => handleSendCampaign(campaign.id)}
                              disabled={isSending}
                            >
                              {isSending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Send className="h-4 w-4 mr-1" />
                                  Enviar
                                </>
                              )}
                            </Button>
                          )}
                          {campaign.status === 'completed' && (
                            <span className="text-sm text-muted-foreground">Concluído</span>
                          )}
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
