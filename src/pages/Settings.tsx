import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCredits } from '@/hooks/useCredits';
import { useWorkspaceMembers } from '@/hooks/useWorkspaceMembers';
import { useAccounts } from '@/hooks/useAccounts';
import { useWorkspaceSettings } from '@/hooks/useWorkspaceSettings';
import { useDailyUsage } from '@/hooks/useDailyUsage';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  Building2, 
  Users, 
  Link2, 
  History,
  Plus,
  Loader2,
  Trash2,
  Crown,
  RefreshCw,
  MessageCircle,
  Linkedin,
  Mail,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Pencil,
  Settings2,
  Copy,
  Check,
  AlertCircle,
  AlertTriangle,
  Clock,
  Save,
  Globe,
} from 'lucide-react';
import { MESSAGE_VARIABLES } from '@/lib/messageVariables';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Common IANA timezone options
const TIMEZONE_OPTIONS = [
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
  { value: 'America/Sao_Paulo', label: 'São Paulo (GMT-3)' },
  { value: 'America/New_York', label: 'Nova York (GMT-5/-4)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (GMT-8/-7)' },
  { value: 'America/Chicago', label: 'Chicago (GMT-6/-5)' },
  { value: 'America/Mexico_City', label: 'Cidade do México (GMT-6)' },
  { value: 'America/Buenos_Aires', label: 'Buenos Aires (GMT-3)' },
  { value: 'America/Lima', label: 'Lima (GMT-5)' },
  { value: 'America/Bogota', label: 'Bogotá (GMT-5)' },
  { value: 'Europe/London', label: 'Londres (GMT+0/+1)' },
  { value: 'Europe/Paris', label: 'Paris (GMT+1/+2)' },
  { value: 'Europe/Berlin', label: 'Berlim (GMT+1/+2)' },
  { value: 'Europe/Madrid', label: 'Madrid (GMT+1/+2)' },
  { value: 'Europe/Lisbon', label: 'Lisboa (GMT+0/+1)' },
  { value: 'Asia/Tokyo', label: 'Tóquio (GMT+9)' },
  { value: 'Asia/Shanghai', label: 'Xangai (GMT+8)' },
  { value: 'Asia/Dubai', label: 'Dubai (GMT+4)' },
  { value: 'Australia/Sydney', label: 'Sydney (GMT+10/+11)' },
];

// Helper for safe number parsing (handles 0 correctly)
function parseNumberInput(value: string, fallback: number, min: number, max: number): number {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export default function Settings() {
  const { profile, workspaces, currentWorkspace, setCurrentWorkspace, user } = useAuth();
  const { credits, creditHistory, isLoading: creditsLoading } = useCredits();
  const { members, isLoading: membersLoading, removeMember, updateRole } = useWorkspaceMembers();
  const { accounts, isLoading: accountsLoading, syncAccounts, isSyncing, refetchAccounts, deleteAccount, isDeleting, updateAccountName, isUpdatingName } = useAccounts();
  const { settings, updateSettings, isUpdating: isUpdatingSettings } = useWorkspaceSettings();
  const { linkedinMessagesToday, linkedinInvitesToday, whatsappMessagesToday, isLoading: usageLoading, refetch: refetchUsage } = useDailyUsage();
  const { toast } = useToast();

  // States for WhatsApp sending limits
  const [dailyLimit, setDailyLimit] = useState<number>(50);
  const [intervalSeconds, setIntervalSeconds] = useState<number>(15);
  const [maxRetries, setMaxRetries] = useState<number>(3);
  
  // States for LinkedIn sending limits
  const [linkedinDailyMessageLimit, setLinkedinDailyMessageLimit] = useState<number>(50);
  const [linkedinDailyInviteLimit, setLinkedinDailyInviteLimit] = useState<number>(25);
  const [linkedinIntervalSeconds, setLinkedinIntervalSeconds] = useState<number>(30);
  
  const [settingsChanged, setSettingsChanged] = useState(false);
  
  // Timezone state
  const [workspaceTimezone, setWorkspaceTimezone] = useState<string>('UTC');
  const [isSavingTimezone, setIsSavingTimezone] = useState(false);

  // Load workspace timezone
  useEffect(() => {
    async function loadTimezone() {
      if (!currentWorkspace) return;
      const { data } = await supabase
        .from('workspaces')
        .select('timezone')
        .eq('id', currentWorkspace.id)
        .single();
      if (data?.timezone) {
        setWorkspaceTimezone(data.timezone);
      }
    }
    loadTimezone();
  }, [currentWorkspace?.id]);

  async function handleSaveTimezone(newTimezone: string) {
    if (!currentWorkspace) return;
    setIsSavingTimezone(true);
    try {
      const { error } = await supabase
        .from('workspaces')
        .update({ timezone: newTimezone })
        .eq('id', currentWorkspace.id);
      if (error) throw error;
      setWorkspaceTimezone(newTimezone);
      toast({
        title: 'Fuso horário atualizado',
        description: `Campanhas agendadas usarão ${newTimezone}.`,
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao salvar',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSavingTimezone(false);
    }
  }

  // Initialize settings from hook
  useEffect(() => {
    if (settings) {
      setDailyLimit(settings.daily_message_limit);
      setIntervalSeconds(settings.message_interval_seconds);
      setMaxRetries(settings.max_retries ?? 3);
      setLinkedinDailyMessageLimit(settings.linkedin_daily_message_limit ?? 50);
      setLinkedinDailyInviteLimit(settings.linkedin_daily_invite_limit ?? 25);
      setLinkedinIntervalSeconds(settings.linkedin_message_interval_seconds ?? 30);
    }
  }, [settings]);

  // Track settings changes
  useEffect(() => {
    if (settings) {
      const whatsappChanged = dailyLimit !== settings.daily_message_limit || 
                              intervalSeconds !== settings.message_interval_seconds ||
                              maxRetries !== (settings.max_retries ?? 3);
      const linkedinChanged = linkedinDailyMessageLimit !== (settings.linkedin_daily_message_limit ?? 50) ||
                              linkedinDailyInviteLimit !== (settings.linkedin_daily_invite_limit ?? 25) ||
                              linkedinIntervalSeconds !== (settings.linkedin_message_interval_seconds ?? 30);
      setSettingsChanged(whatsappChanged || linkedinChanged);
    }
  }, [dailyLimit, intervalSeconds, maxRetries, linkedinDailyMessageLimit, linkedinDailyInviteLimit, linkedinIntervalSeconds, settings]);

  async function handleSaveSettings() {
    try {
      await updateSettings({
        daily_message_limit: dailyLimit,
        message_interval_seconds: intervalSeconds,
        max_retries: maxRetries,
        linkedin_daily_message_limit: linkedinDailyMessageLimit,
        linkedin_daily_invite_limit: linkedinDailyInviteLimit,
        linkedin_message_interval_seconds: linkedinIntervalSeconds,
      });
      toast({
        title: 'Configurações salvas',
        description: 'Os limites de envio foram atualizados com sucesso.',
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao salvar',
        description: error.message,
        variant: 'destructive',
      });
    }
  }

  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [inviteMemberOpen, setInviteMemberOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [connectingWhatsApp, setConnectingWhatsApp] = useState(false);
  const [connectingLinkedIn, setConnectingLinkedIn] = useState(false);
  const [waitingForConnection, setWaitingForConnection] = useState(false);
  const [connectingChannel, setConnectingChannel] = useState<'whatsapp' | 'linkedin' | null>(null);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<{ id: string; name: string } | null>(null);
  const [connectAccountOpen, setConnectAccountOpen] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [editAccountOpen, setEditAccountOpen] = useState(false);
  const [accountToEdit, setAccountToEdit] = useState<{ id: string; name: string } | null>(null);
  const [editAccountName, setEditAccountName] = useState('');
  const [selectedChannel, setSelectedChannel] = useState<'whatsapp' | 'linkedin'>('whatsapp');

  const currentMember = members.find(m => m.user_id === user?.id);
  const isAdmin = currentMember?.role === 'admin';

  const channelIcons: Record<string, React.ElementType> = {
    whatsapp: MessageCircle,
    linkedin: Linkedin,
    email: Mail,
  };

  const channelLabels: Record<string, string> = {
    whatsapp: 'WhatsApp',
    linkedin: 'LinkedIn',
    email: 'Email',
  };

  async function handleSyncAccounts() {
    try {
      const result = await syncAccounts();
      toast({
        title: 'Contas sincronizadas',
        description: `${result.synced} conta(s) atualizada(s).`,
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao sincronizar',
        description: error.message,
        variant: 'destructive',
      });
    }
  }

  // ============================================
  // CONNECT ACCOUNT VIA HOSTED AUTH LINK
  // ============================================
  function openConnectModal(channel: 'whatsapp' | 'linkedin') {
    setSelectedChannel(channel);
    setNewAccountName('');
    setConnectAccountOpen(true);
  }

  async function handleConnectAccount() {
    if (!currentWorkspace || !newAccountName.trim()) return;

    setConnectAccountOpen(false);
    
    if (selectedChannel === 'whatsapp') {
      setConnectingWhatsApp(true);
    } else {
      setConnectingLinkedIn(true);
    }
    setConnectingChannel(selectedChannel);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({
          title: 'Sessão expirada',
          description: 'Faça login novamente.',
          variant: 'destructive',
        });
        return;
      }

      const response = await supabase.functions.invoke('create-connect-link', {
        body: { 
          workspaceId: currentWorkspace.id, 
          channel: selectedChannel,
          accountName: newAccountName.trim(),
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Erro ao criar link de conexão');
      }

      const { url } = response.data;
      if (!url) {
        throw new Error('URL de conexão não retornada');
      }

      // Open the hosted auth link in a new tab
      window.open(url, '_blank');

      // Show waiting state
      setWaitingForConnection(true);
      toast({
        title: 'Link aberto',
        description: `Complete a conexão do ${selectedChannel === 'whatsapp' ? 'WhatsApp' : 'LinkedIn'} na nova aba. Se a aba não redirecionar, pode fechar — a conta aparecerá automaticamente quando conectar.`,
      });

      // Poll for new accounts for 2 minutes as fallback
      const pollIntervalId = setInterval(async () => {
        await refetchAccounts();
      }, 5000);

      // Store interval ID for cleanup
      const timeoutId = setTimeout(() => {
        clearInterval(pollIntervalId);
        setWaitingForConnection(false);
        setConnectingChannel(null);
        setConnectingWhatsApp(false);
        setConnectingLinkedIn(false);
      }, 120000); // Stop polling after 2 minutes

      // Cleanup on success (handled by realtime subscription)
      // The realtime subscription will clear these states when account is connected

    } catch (error: any) {
      console.error(`Error connecting ${selectedChannel}:`, error);
      toast({
        title: 'Erro ao conectar',
        description: error.message,
        variant: 'destructive',
      });
      // Reset all states on error
      setWaitingForConnection(false);
      setConnectingChannel(null);
      setConnectingWhatsApp(false);
      setConnectingLinkedIn(false);
    }
  }

  // ============================================
  // EDIT ACCOUNT NAME
  // ============================================
  function openEditModal(account: { id: string; name: string | null }) {
    setAccountToEdit({ id: account.id, name: account.name || '' });
    setEditAccountName(account.name || '');
    setEditAccountOpen(true);
  }

  async function handleUpdateAccountName() {
    if (!accountToEdit || !editAccountName.trim()) return;

    try {
      await updateAccountName({ accountId: accountToEdit.id, name: editAccountName.trim() });
      toast({
        title: 'Nome atualizado',
        description: 'O nome da conta foi atualizado com sucesso.',
      });
      setEditAccountOpen(false);
      setAccountToEdit(null);
    } catch (error: any) {
      toast({
        title: 'Erro ao atualizar',
        description: error.message,
        variant: 'destructive',
      });
    }
  }

  // Subscribe to accounts table for realtime updates
  useEffect(() => {
    if (!currentWorkspace) return;

    const channel = supabase
      .channel('accounts-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'accounts',
          filter: `workspace_id=eq.${currentWorkspace.id}`,
        },
        async (payload) => {
          console.log('Account change detected:', payload);
          await refetchAccounts();
          
          // Check if the event is INSERT or UPDATE with connected status
          if (payload.eventType === 'INSERT' || 
              (payload.eventType === 'UPDATE' && (payload.new as any)?.status === 'connected')) {
            // Clear all waiting states
            setWaitingForConnection(false);
            setConnectingWhatsApp(false);
            setConnectingLinkedIn(false);
            setConnectingChannel(null);
            
            const connectedChannel = (payload.new as any)?.channel || 'conta';
            toast({
              title: 'Conta conectada!',
              description: `${connectedChannel === 'whatsapp' ? 'WhatsApp' : connectedChannel === 'linkedin' ? 'LinkedIn' : 'Conta'} conectado com sucesso.`,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentWorkspace?.id, refetchAccounts, toast]);

  // Check if accounts have connected status and reset waiting state
  useEffect(() => {
    if (waitingForConnection && accounts.some(acc => acc.status === 'connected')) {
      setWaitingForConnection(false);
      setConnectingWhatsApp(false);
      setConnectingLinkedIn(false);
      setConnectingChannel(null);
    }
  }, [accounts, waitingForConnection]);

  async function handleCreateWorkspace() {
    if (!newWorkspaceName.trim()) return;

    setCreating(true);
    try {
      // Create workspace
      const { data: workspace, error: wsError } = await supabase
        .from('workspaces')
        .insert({ name: newWorkspaceName, created_by: user?.id })
        .select()
        .single();

      if (wsError) throw wsError;

      // Add user as admin
      const { error: memberError } = await supabase
        .from('workspace_members')
        .insert({ workspace_id: workspace.id, user_id: user?.id, role: 'admin' });

      if (memberError) throw memberError;

      // Create initial credits
      const { error: creditsError } = await supabase
        .from('credits')
        .insert({ workspace_id: workspace.id, leads_credits: 100, phone_credits: 10 });

      if (creditsError) throw creditsError;

      toast({
        title: 'Workspace criado',
        description: `"${newWorkspaceName}" foi criado com sucesso.`,
      });

      setCreateWorkspaceOpen(false);
      setNewWorkspaceName('');
      // Refresh workspaces
      window.location.reload();
    } catch (error: any) {
      toast({
        title: 'Erro ao criar workspace',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  }

  async function handleInviteMember() {
    if (!inviteEmail.trim() || !currentWorkspace) return;

    setInviting(true);
    try {
      // Note: In a real app, you'd send an invitation email
      // For now, we'll just show a message
      toast({
        title: 'Convite enviado',
        description: `Um convite foi enviado para ${inviteEmail}.`,
      });

      setInviteMemberOpen(false);
      setInviteEmail('');
    } catch (error: any) {
      toast({
        title: 'Erro ao convidar',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setInviting(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    try {
      await removeMember(memberId);
      toast({
        title: 'Membro removido',
        description: 'O membro foi removido do workspace.',
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao remover',
        description: error.message,
        variant: 'destructive',
      });
    }
  }

  async function handleDeleteAccount() {
    if (!accountToDelete) return;
    
    try {
      await deleteAccount(accountToDelete.id);
      toast({
        title: 'Conta removida',
        description: 'A conta foi desconectada com sucesso.',
      });
      setDeleteAccountOpen(false);
      setAccountToDelete(null);
    } catch (error: any) {
      toast({
        title: 'Erro ao remover conta',
        description: error.message,
        variant: 'destructive',
      });
    }
  }

  const typeLabels: Record<string, string> = {
    lead_search: 'Busca de Leads',
    phone_enrich: 'Enriquecimento',
    credit_add: 'Créditos Adicionados',
    credit_deduct: 'Créditos Deduzidos',
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Configurações</h1>
          <p className="text-muted-foreground">
            Gerencie seu workspace e integrações
          </p>
        </div>

        <Tabs defaultValue="workspace">
          <TabsList>
            <TabsTrigger value="workspace" className="gap-2">
              <Building2 className="h-4 w-4" />
              Workspace
            </TabsTrigger>
            <TabsTrigger value="team" className="gap-2">
              <Users className="h-4 w-4" />
              Time
            </TabsTrigger>
            <TabsTrigger value="integrations" className="gap-2">
              <Link2 className="h-4 w-4" />
              Integrações
            </TabsTrigger>
            <TabsTrigger value="credits" className="gap-2">
              <History className="h-4 w-4" />
              Créditos
            </TabsTrigger>
            <TabsTrigger value="preferences" className="gap-2">
              <Settings2 className="h-4 w-4" />
              Preferências
            </TabsTrigger>
          </TabsList>

          <TabsContent value="workspace" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Workspace Atual</CardTitle>
                <CardDescription>
                  Informações do workspace selecionado
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Nome do Workspace</Label>
                  <Input value={currentWorkspace?.name || ''} disabled />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    Fuso Horário
                  </Label>
                  <Select 
                    value={workspaceTimezone} 
                    onValueChange={handleSaveTimezone}
                    disabled={isSavingTimezone}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o fuso horário" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONE_OPTIONS.map(tz => (
                        <SelectItem key={tz.value} value={tz.value}>
                          {tz.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Usado para agendamento de campanhas diferidas (ex.: 09:00 local).
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Créditos de Leads</Label>
                    <Input value={credits?.leads_credits || 0} disabled />
                  </div>
                  <div className="space-y-2">
                    <Label>Créditos de Telefone</Label>
                    <Input value={credits?.phone_credits || 0} disabled />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Seus Workspaces</CardTitle>
                    <CardDescription>
                      Workspaces aos quais você pertence
                    </CardDescription>
                  </div>
                  <Dialog open={createWorkspaceOpen} onOpenChange={setCreateWorkspaceOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm">
                        <Plus className="mr-2 h-4 w-4" />
                        Novo Workspace
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Criar Novo Workspace</DialogTitle>
                        <DialogDescription>
                          Crie um novo workspace para sua equipe
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="workspaceName">Nome do Workspace</Label>
                          <Input
                            id="workspaceName"
                            placeholder="Minha Empresa"
                            value={newWorkspaceName}
                            onChange={(e) => setNewWorkspaceName(e.target.value)}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateWorkspaceOpen(false)}>
                          Cancelar
                        </Button>
                        <Button onClick={handleCreateWorkspace} disabled={creating}>
                          {creating ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Criando...
                            </>
                          ) : (
                            'Criar'
                          )}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {workspaces.map((ws) => (
                    <button
                      key={ws.id}
                      onClick={() => setCurrentWorkspace(ws)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        ws.id === currentWorkspace?.id
                          ? 'border-primary bg-primary/5'
                          : 'hover:bg-muted'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{ws.name}</span>
                        {ws.id === currentWorkspace?.id && (
                          <Badge variant="secondary">Ativo</Badge>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="team" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Membros do Time</CardTitle>
                    <CardDescription>
                      Pessoas com acesso ao workspace "{currentWorkspace?.name}"
                    </CardDescription>
                  </div>
                  {isAdmin && (
                    <Dialog open={inviteMemberOpen} onOpenChange={setInviteMemberOpen}>
                      <DialogTrigger asChild>
                        <Button size="sm">
                          <Plus className="mr-2 h-4 w-4" />
                          Convidar
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Convidar Membro</DialogTitle>
                          <DialogDescription>
                            Envie um convite por email
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                              id="email"
                              type="email"
                              placeholder="colega@empresa.com"
                              value={inviteEmail}
                              onChange={(e) => setInviteEmail(e.target.value)}
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setInviteMemberOpen(false)}>
                            Cancelar
                          </Button>
                          <Button onClick={handleInviteMember} disabled={inviting}>
                            {inviting ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Enviando...
                              </>
                            ) : (
                              'Enviar Convite'
                            )}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {membersLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Membro</TableHead>
                        <TableHead>Função</TableHead>
                        <TableHead>Desde</TableHead>
                        {isAdmin && <TableHead className="w-12"></TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map((member) => (
                        <TableRow key={member.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                                <span className="text-sm font-medium text-primary">
                                  {member.profile?.full_name?.charAt(0) || member.profile?.email?.charAt(0) || 'U'}
                                </span>
                              </div>
                              <div>
                                <p className="font-medium">{member.profile?.full_name || 'Usuário'}</p>
                                <p className="text-sm text-muted-foreground">{member.profile?.email}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={member.role === 'admin' ? 'default' : 'secondary'}>
                              {member.role === 'admin' && <Crown className="mr-1 h-3 w-3" />}
                              {member.role === 'admin' ? 'Admin' : 'Membro'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {format(new Date(member.joined_at), 'dd/MM/yyyy', { locale: ptBR })}
                          </TableCell>
                          {isAdmin && (
                            <TableCell>
                              {member.user_id !== user?.id && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleRemoveMember(member.id)}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="integrations" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Contas Conectadas</CardTitle>
                    <CardDescription>
                      Contas de mensageria para envio de campanhas
                    </CardDescription>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <Button 
                        size="sm" 
                        onClick={() => openConnectModal('whatsapp')}
                        disabled={connectingWhatsApp || (waitingForConnection && connectingChannel === 'whatsapp')}
                      >
                        {connectingWhatsApp ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Gerando link...
                          </>
                        ) : (waitingForConnection && connectingChannel === 'whatsapp') ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Aguardando...
                          </>
                        ) : (
                          <>
                            <MessageCircle className="mr-2 h-4 w-4" />
                            WhatsApp
                            <ExternalLink className="ml-1 h-3 w-3" />
                          </>
                        )}
                      </Button>
                      <Button 
                        size="sm" 
                        onClick={() => openConnectModal('linkedin')}
                        disabled={connectingLinkedIn || (waitingForConnection && connectingChannel === 'linkedin')}
                      >
                        {connectingLinkedIn ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Gerando link...
                          </>
                        ) : (waitingForConnection && connectingChannel === 'linkedin') ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Aguardando...
                          </>
                        ) : (
                          <>
                            <Linkedin className="mr-2 h-4 w-4" />
                            LinkedIn
                            <ExternalLink className="ml-1 h-3 w-3" />
                          </>
                        )}
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={handleSyncAccounts}
                        disabled={isSyncing}
                      >
                        {isSyncing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {accountsLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : accounts.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Link2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhuma conta conectada.</p>
                    <p className="text-sm">
                      {isAdmin 
                        ? 'Clique em "Sincronizar Contas" para buscar contas do painel de mensageria.' 
                        : 'Peça a um admin para sincronizar as contas.'}
                    </p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Canal</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Atualizado</TableHead>
                        {isAdmin && <TableHead className="text-right">Ações</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {accounts.map((account) => {
                        const ChannelIcon = channelIcons[account.channel] || Link2;
                        // LinkedIn feature badge labels
                        const linkedinFeatureLabels: Record<string, string> = {
                          classic: 'Classic',
                          sales_navigator: 'Sales Navigator',
                          recruiter: 'Recruiter',
                        };
                        const linkedinFeature = (account as any).linkedin_feature;
                        const featureLabel = linkedinFeature ? linkedinFeatureLabels[linkedinFeature] || linkedinFeature : null;
                        
                        return (
                          <TableRow key={account.id}>
                            <TableCell className="font-medium">
                              {account.name || account.account_id.slice(0, 12)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <ChannelIcon className="h-4 w-4" />
                                {channelLabels[account.channel] || account.channel}
                                {account.channel === 'linkedin' && featureLabel && (
                                  <Badge variant="outline" className="text-xs">
                                    {featureLabel}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge 
                                variant={account.status === 'connected' ? 'default' : 'destructive'}
                                className="gap-1"
                              >
                                {account.status === 'connected' ? (
                                  <CheckCircle2 className="h-3 w-3" />
                                ) : (
                                  <XCircle className="h-3 w-3" />
                                )}
                                {account.status === 'connected' ? 'Conectado' : 'Desconectado'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {format(new Date(account.updated_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                            </TableCell>
                            {isAdmin && (
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openEditModal(account)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                    onClick={() => {
                                      setAccountToDelete({
                                        id: account.id,
                                        name: account.name || account.account_id.slice(0, 12),
                                      });
                                      setDeleteAccountOpen(true);
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}

                {/* Delete Account Confirmation Dialog */}
                <Dialog open={deleteAccountOpen} onOpenChange={setDeleteAccountOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Remover Conta</DialogTitle>
                      <DialogDescription>
                        Tem certeza que deseja remover a conta "{accountToDelete?.name}"? 
                        Esta ação não pode ser desfeita.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setDeleteAccountOpen(false)}>
                        Cancelar
                      </Button>
                      <Button 
                        variant="destructive" 
                        onClick={handleDeleteAccount}
                        disabled={isDeleting}
                      >
                        {isDeleting ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Removendo...
                          </>
                        ) : (
                          'Remover'
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* Connect Account Modal */}
                <Dialog open={connectAccountOpen} onOpenChange={setConnectAccountOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        {selectedChannel === 'whatsapp' ? (
                          <MessageCircle className="h-5 w-5" />
                        ) : (
                          <Linkedin className="h-5 w-5" />
                        )}
                        Conectar {selectedChannel === 'whatsapp' ? 'WhatsApp' : 'LinkedIn'}
                      </DialogTitle>
                      <DialogDescription>
                        Digite um nome para identificar esta conta de {selectedChannel === 'whatsapp' ? 'WhatsApp' : 'LinkedIn'}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="accountName">Nome da Conta</Label>
                        <Input
                          id="accountName"
                          placeholder={selectedChannel === 'whatsapp' ? 'Ex: WhatsApp Comercial' : 'Ex: LinkedIn Vendas'}
                          value={newAccountName}
                          onChange={(e) => setNewAccountName(e.target.value)}
                        />
                      </div>
                      {selectedChannel === 'linkedin' && (
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Tipos de conta suportados</AlertTitle>
                          <AlertDescription>
                            Classic, Sales Navigator e Recruiter. A conexão abrirá em uma nova aba.
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setConnectAccountOpen(false)}>
                        Cancelar
                      </Button>
                      <Button 
                        onClick={handleConnectAccount}
                        disabled={!newAccountName.trim()}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Continuar
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* Edit Account Name Modal */}
                <Dialog open={editAccountOpen} onOpenChange={setEditAccountOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Editar Nome da Conta</DialogTitle>
                      <DialogDescription>
                        Altere o nome de identificação desta conta
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="editAccountName">Nome da Conta</Label>
                        <Input
                          id="editAccountName"
                          placeholder="Ex: WhatsApp Comercial"
                          value={editAccountName}
                          onChange={(e) => setEditAccountName(e.target.value)}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setEditAccountOpen(false)}>
                        Cancelar
                      </Button>
                      <Button 
                        onClick={handleUpdateAccountName}
                        disabled={!editAccountName.trim() || isUpdatingName}
                      >
                        {isUpdatingName ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Salvando...
                          </>
                        ) : (
                          'Salvar'
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="credits" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Histórico de Créditos</CardTitle>
                <CardDescription>
                  Movimentações de créditos do workspace
                </CardDescription>
              </CardHeader>
              <CardContent>
                {creditsLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : creditHistory.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhuma movimentação ainda.</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="text-right">Quantidade</TableHead>
                        <TableHead className="text-right">Data</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {creditHistory.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <Badge variant={item.type.includes('add') ? 'default' : 'secondary'}>
                              {typeLabels[item.type] || item.type}
                            </Badge>
                          </TableCell>
                          <TableCell>{item.description || '-'}</TableCell>
                          <TableCell className="text-right">
                            <span className={item.amount > 0 ? 'text-green-600' : 'text-destructive'}>
                              {item.amount > 0 ? '+' : ''}{item.amount}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            {format(new Date(item.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="preferences" className="space-y-4">
            <Tabs defaultValue="whatsapp" className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="whatsapp" className="gap-2">
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </TabsTrigger>
                <TabsTrigger value="email" className="gap-2">
                  <Mail className="h-4 w-4" />
                  Email
                </TabsTrigger>
                <TabsTrigger value="linkedin" className="gap-2">
                  <Linkedin className="h-4 w-4" />
                  LinkedIn
                </TabsTrigger>
              </TabsList>

              {/* WhatsApp Preferences */}
              <TabsContent value="whatsapp" className="space-y-4">
                {/* Card de Limites de Envio */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Clock className="h-5 w-5" />
                          Limites de Envio
                        </CardTitle>
                        <CardDescription>
                          Configure os limites diários e intervalos para evitar bloqueios de conta
                        </CardDescription>
                      </div>
                      {settingsChanged && (
                        <Button onClick={handleSaveSettings} disabled={isUpdatingSettings}>
                          {isUpdatingSettings ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="mr-2 h-4 w-4" />
                          )}
                          Salvar
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid gap-6 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="dailyLimit">Limite diário de mensagens</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="dailyLimit"
                            type="number"
                            min={1}
                            max={500}
                            value={dailyLimit}
                            onChange={(e) => setDailyLimit(parseNumberInput(e.target.value, 50, 1, 500))}
                            className="w-32"
                          />
                          <span className="text-sm text-muted-foreground">mensagens/dia</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Campanhas maiores serão divididas em múltiplos dias.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="intervalSeconds">Intervalo entre mensagens</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="intervalSeconds"
                            type="number"
                            min={10}
                            max={120}
                            value={intervalSeconds}
                            onChange={(e) => setIntervalSeconds(parseNumberInput(e.target.value, 15, 10, 120))}
                            className="w-32"
                          />
                          <span className="text-sm text-muted-foreground">segundos</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Mínimo: 10s. Recomendado: 15-30s para simular comportamento humano.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="maxRetries">Tentativas de reenvio</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="maxRetries"
                            type="number"
                            min={0}
                            max={10}
                            value={maxRetries}
                            onChange={(e) => setMaxRetries(parseNumberInput(e.target.value, 3, 0, 10))}
                            className="w-32"
                          />
                          <span className="text-sm text-muted-foreground">tentativas</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Mensagens falhas serão reenviadas automaticamente.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Card de Boas Práticas */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertCircle className="h-5 w-5" />
                      Boas Práticas do WhatsApp
                    </CardTitle>
                    <CardDescription>
                      Siga estas recomendações para evitar suspensão da conta
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3 text-sm">
                      <li className="flex items-start gap-3">
                        <MessageCircle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                        <div>
                          <span className="font-medium">Use contas com histórico</span>
                          <p className="text-muted-foreground">Evite contas novas exclusivamente para automação. Prefira contas com atividade real de usuários.</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <CheckCircle2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                        <div>
                          <span className="font-medium">Engaje os usuários</span>
                          <p className="text-muted-foreground">A primeira mensagem deve solicitar uma resposta para manter conversas ativas.</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <XCircle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                        <div>
                          <span className="font-medium">Evite spam</span>
                          <p className="text-muted-foreground">Muitos chats sem resposta podem restringir sua conta temporariamente.</p>
                        </div>
                      </li>
                    </ul>
                  </CardContent>
                </Card>

                {/* Card de Variáveis de Mensagem */}
                <Card>
                  <CardHeader>
                    <CardTitle>Variáveis de Mensagem</CardTitle>
                    <CardDescription>
                      Use estas variáveis nas suas campanhas para personalizar automaticamente as mensagens para cada lead.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Variável</TableHead>
                          <TableHead>Campo</TableHead>
                          <TableHead>Descrição</TableHead>
                          <TableHead className="w-16"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {MESSAGE_VARIABLES.map((variable) => (
                          <VariableRow key={variable.variable} variable={variable} />
                        ))}
                      </TableBody>
                    </Table>
                    <div className="mt-4 p-4 border rounded-lg bg-muted/50">
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                        <div>
                          <p className="font-medium text-foreground">Dica</p>
                          <p>Se o campo estiver vazio para um lead, a variável será substituída por texto vazio. Certifique-se de que seus leads tenham os dados preenchidos para melhor personalização.</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Exemplo de Uso</CardTitle>
                    <CardDescription>
                      Veja como as variáveis funcionam em uma mensagem
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-4 border rounded-lg bg-muted/30">
                      <p className="text-sm font-medium text-muted-foreground mb-2">Mensagem com variáveis:</p>
                      <p className="font-mono text-sm">
                        Olá {"{{primeiro_nome}}"}, vi que você trabalha na {"{{empresa}}"} como {"{{cargo}}"}. Podemos conversar?
                      </p>
                    </div>
                    <div className="p-4 border rounded-lg bg-primary/5 border-primary/20">
                      <p className="text-sm font-medium text-muted-foreground mb-2">Resultado para o lead:</p>
                      <p className="text-sm">
                        Olá <span className="font-semibold text-primary">João</span>, vi que você trabalha na <span className="font-semibold text-primary">Empresa ABC</span> como <span className="font-semibold text-primary">CEO</span>. Podemos conversar?
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Email Preferences */}
              <TabsContent value="email" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Mail className="h-5 w-5" />
                      Configurações de Email
                    </CardTitle>
                    <CardDescription>
                      Configure as preferências para campanhas de email
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center py-12 text-muted-foreground">
                      <Mail className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p className="font-medium">Em breve</p>
                      <p className="text-sm">As configurações de email estarão disponíveis em breve.</p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* LinkedIn Preferences */}
              <TabsContent value="linkedin" className="space-y-4">
                {/* Card de Uso de Hoje */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <History className="h-5 w-5" />
                          Uso de Hoje
                        </CardTitle>
                        <CardDescription>
                          Ações realizadas hoje em todas as contas LinkedIn
                        </CardDescription>
                      </div>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => refetchUsage()}
                        disabled={usageLoading}
                      >
                        {usageLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-full bg-primary/10">
                            <MessageCircle className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">Mensagens</p>
                            <p className="text-xs text-muted-foreground">DMs enviadas hoje</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold">
                            {usageLoading ? (
                              <Skeleton className="h-8 w-16 inline-block" />
                            ) : (
                              <>
                                {linkedinMessagesToday}
                                <span className="text-sm font-normal text-muted-foreground">
                                  /{settings.linkedin_daily_message_limit ?? 50}
                                </span>
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-full bg-secondary/50">
                            <Users className="h-5 w-5 text-secondary-foreground" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">Convites</p>
                            <p className="text-xs text-muted-foreground">Conexões enviadas hoje</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold">
                            {usageLoading ? (
                              <Skeleton className="h-8 w-16 inline-block" />
                            ) : (
                              <>
                                {linkedinInvitesToday}
                                <span className="text-sm font-normal text-muted-foreground">
                                  /{settings.linkedin_daily_invite_limit ?? 25}
                                </span>
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Card de Limites de Envio LinkedIn */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Clock className="h-5 w-5" />
                          Limites de Envio LinkedIn
                        </CardTitle>
                        <CardDescription>
                          Configure os limites diários para mensagens e convites de conexão
                        </CardDescription>
                      </div>
                      {settingsChanged && (
                        <Button onClick={handleSaveSettings} disabled={isUpdatingSettings}>
                          {isUpdatingSettings ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="mr-2 h-4 w-4" />
                          )}
                          Salvar
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid gap-6 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="linkedinDailyMessageLimit">Limite diário de mensagens</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="linkedinDailyMessageLimit"
                            type="number"
                            min={1}
                            max={100}
                            value={linkedinDailyMessageLimit}
                            onChange={(e) => setLinkedinDailyMessageLimit(parseNumberInput(e.target.value, 50, 1, 100))}
                            className="w-32"
                          />
                          <span className="text-sm text-muted-foreground">msg/dia</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          DMs para conexões e InMails (Premium).
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="linkedinDailyInviteLimit">Limite diário de convites</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="linkedinDailyInviteLimit"
                            type="number"
                            min={1}
                            max={50}
                            value={linkedinDailyInviteLimit}
                            onChange={(e) => setLinkedinDailyInviteLimit(parseNumberInput(e.target.value, 25, 1, 50))}
                            className="w-32"
                          />
                          <span className="text-sm text-muted-foreground">convites/dia</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Solicitações de conexão com ou sem nota.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="linkedinIntervalSeconds">Intervalo entre ações</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="linkedinIntervalSeconds"
                            type="number"
                            min={10}
                            max={300}
                            value={linkedinIntervalSeconds}
                            onChange={(e) => setLinkedinIntervalSeconds(parseNumberInput(e.target.value, 30, 10, 300))}
                            className="w-32"
                          />
                          <span className="text-sm text-muted-foreground">segundos</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Mínimo recomendado: 30s para simular comportamento humano.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Card de Boas Práticas LinkedIn */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5" />
                      Boas Práticas do LinkedIn
                    </CardTitle>
                    <CardDescription>
                      Siga estas recomendações para evitar restrições na sua conta
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3 text-sm">
                      <li className="flex items-start gap-3">
                        <Users className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                        <div>
                          <span className="font-medium">Limite ~100 ações/dia por conta</span>
                          <p className="text-muted-foreground">Inclui mensagens, convites, visitas de perfil. Contas novas devem usar limites menores (20-30/dia).</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <Clock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                        <div>
                          <span className="font-medium">Espaçar ações de forma aleatória</span>
                          <p className="text-muted-foreground">Evite padrões previsíveis. O sistema adiciona variação automática ao intervalo configurado.</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <Mail className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                        <div>
                          <span className="font-medium">~800 InMails gratuitos/mês</span>
                          <p className="text-muted-foreground">Contas Premium têm limite mensal de InMails. DMs para conexões são ilimitadas.</p>
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                        <div>
                          <span className="font-medium">Webhook de conexão aceita tem delay</span>
                          <p className="text-muted-foreground">A notificação de convite aceito pode levar até 8 horas (não é tempo real).</p>
                        </div>
                      </li>
                    </ul>
                  </CardContent>
                </Card>

                {/* Card de Tipos de Conta LinkedIn */}
                <Card>
                  <CardHeader>
                    <CardTitle>Tipos de Conta Suportados</CardTitle>
                    <CardDescription>
                      A Elevos suporta diferentes tipos de conta LinkedIn
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="p-4 border rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <Linkedin className="h-5 w-5 text-blue-600" />
                          <span className="font-medium">Classic</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Conta pessoal padrão. DMs para conexões, convites com nota.
                        </p>
                      </div>
                      <div className="p-4 border rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <Crown className="h-5 w-5 text-yellow-600" />
                          <span className="font-medium">Sales Navigator</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          InMails inclusos, busca avançada, salvar leads em listas.
                        </p>
                      </div>
                      <div className="p-4 border rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <Users className="h-5 w-5 text-purple-600" />
                          <span className="font-medium">Recruiter</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          InMails de recrutamento, busca de candidatos, pipelines.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

// Componente para linha de variável com botão de copiar
function VariableRow({ variable }: { variable: typeof MESSAGE_VARIABLES[0] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(variable.variable);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <TableRow>
      <TableCell>
        <code className="px-2 py-1 rounded bg-muted font-mono text-sm">
          {variable.variable}
        </code>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{variable.label}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {variable.description}
      </TableCell>
      <TableCell>
        <Button variant="ghost" size="icon" onClick={handleCopy}>
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </TableCell>
    </TableRow>
  );
}
