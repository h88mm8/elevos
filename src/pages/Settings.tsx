import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCredits } from '@/hooks/useCredits';
import { useWorkspaceMembers } from '@/hooks/useWorkspaceMembers';
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
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  Building2, 
  Users, 
  Link2, 
  History,
  Plus,
  Loader2,
  Trash2,
  Crown
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function Settings() {
  const { profile, workspaces, currentWorkspace, setCurrentWorkspace, user } = useAuth();
  const { credits, creditHistory, isLoading: creditsLoading } = useCredits();
  const { members, isLoading: membersLoading, removeMember, updateRole } = useWorkspaceMembers();
  const { toast } = useToast();

  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [inviteMemberOpen, setInviteMemberOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);

  const currentMember = members.find(m => m.user_id === user?.id);
  const isAdmin = currentMember?.role === 'admin';

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
                <CardTitle>Integrações</CardTitle>
                <CardDescription>
                  Contas conectadas para envio de mensagens
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-12 text-muted-foreground">
                  <Link2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Nenhuma integração configurada.</p>
                  <p className="text-sm">As contas Unipile serão exibidas aqui.</p>
                </div>
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
        </Tabs>
      </div>
    </AppLayout>
  );
}
