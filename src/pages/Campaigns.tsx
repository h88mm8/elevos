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
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { CampaignReportDialog } from '@/components/campaigns/CampaignReportDialog';
import { EditScheduledCampaignDialog } from '@/components/campaigns/EditScheduledCampaignDialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  Trash2,
  Clock,
  BarChart3,
  CalendarClock,
  Pencil,
  XCircle,
  Copy,
  UserPlus,
  MessageSquare,
  Sparkles,
  Info,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { format, setHours, setMinutes } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Lead, Campaign, LinkedInAction } from '@/types';
import { MESSAGE_VARIABLES, getMessagePreview } from '@/lib/messageVariables';

const linkedInActionLabels: Record<LinkedInAction, { label: string; description: string }> = {
  dm: { label: 'Mensagem (DM)', description: 'Envia mensagem para conexões' },
  inmail: { label: 'InMail (Premium)', description: 'Requer créditos InMail' },
  invite: { label: 'Convite de Conexão', description: 'Envia solicitação de conexão' },
};

const statusLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: 'Rascunho', variant: 'secondary' },
  scheduled: { label: 'Agendada', variant: 'outline' },
  sending: { label: 'Enviando...', variant: 'default' },
  running: { label: 'Enviando', variant: 'default' },
  paused: { label: 'Pausada', variant: 'secondary' },
  completed: { label: 'Concluída', variant: 'default' },
  partial: { label: 'Parcial', variant: 'outline' },
  failed: { label: 'Falhou', variant: 'destructive' },
  queued: { label: 'Na fila', variant: 'outline' },
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
  const { campaigns, isLoading, createCampaign, updateCampaign, refetchCampaigns } = useCampaigns();
  const { leads } = useLeads();
  const { accounts } = useAccounts();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [sendingCampaignId, setSendingCampaignId] = useState<string | null>(null);
  const [reportCampaign, setReportCampaign] = useState<{ id: string; name: string } | null>(null);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [cancelCampaignId, setCancelCampaignId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Form state
  const [name, setName] = useState('');
  const [type, setType] = useState<'email' | 'whatsapp' | 'linkedin'>('email');
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [linkedInAction, setLinkedInAction] = useState<LinkedInAction>('dm');
  
  // Schedule state
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<Date | undefined>(undefined);
  const [scheduleTime, setScheduleTime] = useState('09:00');

  // Message character limit for invite notes
  const MAX_INVITE_NOTE_LENGTH = 300;
  const isInviteAction = type === 'linkedin' && linkedInAction === 'invite';

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
    setScheduleEnabled(false);
    setScheduleDate(undefined);
    setScheduleTime('09:00');
    setLinkedInAction('dm');
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

  // Reset account and linkedin action when type changes
  function handleTypeChange(newType: 'email' | 'whatsapp' | 'linkedin') {
    setType(newType);
    setSelectedAccountId('');
    if (newType !== 'linkedin') {
      setLinkedInAction('dm');
    }
  }

  async function handleCreateCampaign() {
    if (!currentWorkspace || !name || selectedLeadIds.size === 0) {
      toast({
        title: 'Campos obrigatórios',
        description: 'Preencha todos os campos e selecione pelo menos 1 lead.',
        variant: 'destructive',
      });
      return;
    }

    // Message is optional for invite action, required for others
    if (!isInviteAction && !message) {
      toast({
        title: 'Mensagem obrigatória',
        description: 'Digite uma mensagem para a campanha.',
        variant: 'destructive',
      });
      return;
    }

    // Validate invite note length
    if (isInviteAction && message.length > MAX_INVITE_NOTE_LENGTH) {
      toast({
        title: 'Nota muito longa',
        description: `A nota do convite deve ter no máximo ${MAX_INVITE_NOTE_LENGTH} caracteres.`,
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
      
      // Build schedule datetime if enabled
      let scheduleISO: string | undefined;
      if (scheduleEnabled && scheduleDate) {
        const [hours, minutes] = scheduleTime.split(':').map(Number);
        const scheduleDatetime = setMinutes(setHours(scheduleDate, hours), minutes);
        scheduleISO = scheduleDatetime.toISOString();
      }
      
      const { data, error } = await supabase.functions.invoke('create-campaign', {
        body: {
          workspaceId: currentWorkspace.id,
          name,
          type,
          message,
          subject: type === 'email' ? subject : undefined,
          accountId: selectedAccountId || undefined,
          schedule: scheduleISO,
          linkedinAction: type === 'linkedin' ? linkedInAction : undefined,
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
        title: scheduleISO ? 'Campanha agendada' : 'Campanha criada',
        description: scheduleISO 
          ? `Campanha "${name}" agendada para ${format(new Date(scheduleISO), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}.`
          : `Campanha "${name}" criada com ${selectedLeadIds.size} leads.`,
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

  async function handleDeleteCampaign(campaignId: string) {
    try {
      const { error } = await supabase
        .from('campaigns')
        .delete()
        .eq('id', campaignId);

      if (error) throw error;

      toast({
        title: 'Campanha excluída',
        description: 'A campanha foi removida com sucesso.',
      });

      refetchCampaigns();
    } catch (error: any) {
      toast({
        title: 'Erro ao excluir campanha',
        description: error.message,
        variant: 'destructive',
      });
    }
  }

  async function handleCancelScheduledCampaign() {
    if (!cancelCampaignId) return;
    try {
      await updateCampaign({ id: cancelCampaignId, status: 'draft', schedule: null });
      toast({
        title: 'Agendamento cancelado',
        description: 'A campanha voltou para rascunho.',
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao cancelar',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setCancelCampaignId(null);
    }
  }

  function handleDuplicateCampaign(campaign: Campaign) {
    setName(`${campaign.name} (cópia)`);
    setType(campaign.type as 'email' | 'whatsapp' | 'linkedin');
    setMessage(campaign.message);
    setSubject(campaign.subject || '');
    setSelectedAccountId(campaign.account_id || '');
    setSelectedLeadIds(new Set());
    setScheduleEnabled(false);
    setScheduleDate(undefined);
    setScheduleTime('09:00');
    setLinkedInAction(campaign.linkedin_action || 'dm');
    setDialogOpen(true);
  }

  async function handleSaveEditedCampaign(updates: { name?: string; message?: string; subject?: string; schedule?: string }) {
    if (!editingCampaign) return;
    
    try {
      await updateCampaign({
        id: editingCampaign.id,
        ...(updates.name && { name: updates.name }),
        ...(updates.message && { message: updates.message }),
        ...(updates.subject !== undefined && { subject: updates.subject }),
        ...(updates.schedule && { schedule: updates.schedule }),
      });
      toast({
        title: 'Campanha atualizada',
        description: 'As alterações foram salvas.',
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao salvar',
        description: error.message,
        variant: 'destructive',
      });
      throw error;
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

                {/* LinkedIn Action Selector */}
                {type === 'linkedin' && (
                  <div className="space-y-2">
                    <Label htmlFor="linkedin-action">Ação do LinkedIn</Label>
                    <Select value={linkedInAction} onValueChange={(v: LinkedInAction) => setLinkedInAction(v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dm">
                          <div className="flex items-center gap-2">
                            <MessageSquare className="h-4 w-4" />
                            <div>
                              <span>Mensagem (DM)</span>
                              <span className="text-xs text-muted-foreground ml-2">Para conexões</span>
                            </div>
                          </div>
                        </SelectItem>
                        <SelectItem value="inmail">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4" />
                            <div>
                              <span>InMail (Premium)</span>
                              <span className="text-xs text-muted-foreground ml-2">Créditos InMail</span>
                            </div>
                          </div>
                        </SelectItem>
                        <SelectItem value="invite">
                          <div className="flex items-center gap-2">
                            <UserPlus className="h-4 w-4" />
                            <div>
                              <span>Convite de Conexão</span>
                              <span className="text-xs text-muted-foreground ml-2">Solicitação</span>
                            </div>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Warning/Info for InMail */}
                    {linkedInAction === 'inmail' && (
                      <Alert className="bg-amber-500/10 border-amber-500/30">
                        <Sparkles className="h-4 w-4 text-amber-500" />
                        <AlertDescription className="text-amber-600 dark:text-amber-400 text-xs">
                          InMail requer conta Premium/Sales Navigator e consome créditos InMail.
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Info for DM */}
                    {linkedInAction === 'dm' && (
                      <Alert className="bg-blue-500/10 border-blue-500/30">
                        <Info className="h-4 w-4 text-blue-500" />
                        <AlertDescription className="text-blue-600 dark:text-blue-400 text-xs">
                          Mensagens diretas só podem ser enviadas para conexões. Se o lead não for conexão, a mensagem falhará.
                        </AlertDescription>
                      </Alert>
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
                    <Label htmlFor="message">
                      {isInviteAction ? 'Nota do convite (opcional)' : 'Mensagem'}
                    </Label>
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
                    <div className="space-y-1">
                      <Textarea
                        ref={textareaRef}
                        id="message"
                        placeholder={isInviteAction 
                          ? "Nota personalizada para o convite (opcional, máx 300 caracteres)" 
                          : "Escreva sua mensagem... Use variáveis como {{primeiro_nome}} para personalizar"
                        }
                        rows={isInviteAction ? 3 : 5}
                        value={message}
                        onChange={(e) => {
                          if (isInviteAction && e.target.value.length > MAX_INVITE_NOTE_LENGTH) {
                            return; // Prevent exceeding limit
                          }
                          setMessage(e.target.value);
                        }}
                        maxLength={isInviteAction ? MAX_INVITE_NOTE_LENGTH : undefined}
                      />
                      {isInviteAction && (
                        <div className="flex justify-end">
                          <span className={`text-xs ${message.length > MAX_INVITE_NOTE_LENGTH * 0.9 ? 'text-amber-500' : 'text-muted-foreground'}`}>
                            {message.length}/{MAX_INVITE_NOTE_LENGTH}
                          </span>
                        </div>
                      )}
                    </div>
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

                {/* Schedule Section */}
                <div className="space-y-3 border-t pt-4">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="schedule-enabled"
                      checked={scheduleEnabled}
                      onCheckedChange={(checked) => setScheduleEnabled(checked === true)}
                    />
                    <Label htmlFor="schedule-enabled" className="flex items-center gap-2 cursor-pointer">
                      <CalendarClock className="h-4 w-4" />
                      Agendar envio
                    </Label>
                  </div>
                  
                  {scheduleEnabled && (
                    <>
                      <div className="grid grid-cols-2 gap-4 pl-6">
                        <div className="space-y-2">
                          <Label>Data</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className="w-full justify-start text-left font-normal"
                              >
                                <Calendar className="mr-2 h-4 w-4" />
                                {scheduleDate ? format(scheduleDate, 'dd/MM/yyyy', { locale: ptBR }) : 'Selecionar data'}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <CalendarComponent
                                mode="single"
                                selected={scheduleDate}
                                onSelect={setScheduleDate}
                                disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="schedule-time">Horário</Label>
                          <Input
                            id="schedule-time"
                            type="time"
                            value={scheduleTime}
                            onChange={(e) => setScheduleTime(e.target.value)}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground pl-6">
                        Fuso horário: {Intl.DateTimeFormat().resolvedOptions().timeZone}
                      </p>
                    </>
                  )}
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
                      {scheduleEnabled ? 'Agendando...' : 'Criando...'}
                    </>
                  ) : scheduleEnabled ? (
                    <>
                      <CalendarClock className="mr-2 h-4 w-4" />
                      Agendar Campanha
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
                          <div className="flex items-center gap-2">
                            {(campaign.status === 'queued' || campaign.status === 'scheduled') && (
                              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                            <Badge variant={statusLabels[campaign.status]?.variant || 'secondary'}>
                              {statusLabels[campaign.status]?.label || campaign.status}
                            </Badge>
                            {campaign.status === 'scheduled' && campaign.schedule && (
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(campaign.schedule), "dd/MM 'às' HH:mm", { locale: ptBR })}
                              </span>
                            )}
                            {campaign.status === 'queued' && campaign.leads_count > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {Math.ceil((campaign.leads_count - campaign.sent_count) / 50)} dias restantes
                              </span>
                            )}
                          </div>
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
                          <div className="flex items-center justify-center gap-1">
                            {/* Report button - always visible for sent campaigns */}
                            {campaign.sent_count > 0 && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => setReportCampaign({ id: campaign.id, name: campaign.name })}
                                title="Ver relatório"
                              >
                                <BarChart3 className="h-4 w-4" />
                              </Button>
                            )}
                            {/* Edit button for scheduled campaigns */}
                            {campaign.status === 'scheduled' && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => setEditingCampaign(campaign)}
                                title="Editar campanha"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {/* Cancel schedule button */}
                            {campaign.status === 'scheduled' && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-amber-500 hover:text-amber-600"
                                onClick={() => setCancelCampaignId(campaign.id)}
                                title="Cancelar agendamento"
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            )}
                            {/* Duplicate campaign button */}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => handleDuplicateCampaign(campaign)}
                              title="Duplicar campanha"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
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
                            {campaign.status === 'completed' && campaign.sent_count === 0 && (
                              <span className="text-sm text-muted-foreground">Concluído</span>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDeleteCampaign(campaign.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
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

      {/* Campaign Report Dialog */}
      <CampaignReportDialog
        campaignId={reportCampaign?.id || null}
        campaignName={reportCampaign?.name}
        open={!!reportCampaign}
        onOpenChange={(open) => !open && setReportCampaign(null)}
      />

      {/* Edit Scheduled Campaign Dialog */}
      <EditScheduledCampaignDialog
        campaign={editingCampaign}
        open={!!editingCampaign}
        onOpenChange={(open) => !open && setEditingCampaign(null)}
        onSave={handleSaveEditedCampaign}
      />

      {/* Cancel Schedule Confirmation Dialog */}
      <AlertDialog open={!!cancelCampaignId} onOpenChange={(open) => !open && setCancelCampaignId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar agendamento?</AlertDialogTitle>
            <AlertDialogDescription>
              A campanha voltará para rascunho e o agendamento será removido. Você poderá reagendar ou enviar manualmente depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não, manter</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelScheduledCampaign}>
              Sim, cancelar agendamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
