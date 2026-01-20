import { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, QrCode, ExternalLink, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface ConnectWhatsAppModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}

type ConnectionStatus = 'idle' | 'loading' | 'pending' | 'connected' | 'failed';

export default function ConnectWhatsAppModal({ 
  open, 
  onOpenChange, 
  onConnected 
}: ConnectWhatsAppModalProps) {
  const { currentWorkspace } = useAuth();
  const { toast } = useToast();
  
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [hostedUrl, setHostedUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const isMountedRef = useRef(true);

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const saveAccount = async (accountId: string, channel: string, name?: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      const { error } = await supabase.functions.invoke('save-account', {
        body: {
          workspaceId: currentWorkspace?.id,
          account_id: accountId,
          channel,
          name,
        },
      });

      if (error) throw error;

      toast({
        title: 'Conta conectada com sucesso',
        description: 'Sua conta de mensagens foi vinculada ao workspace.',
      });

      onConnected();
      onOpenChange(false);
    } catch (err: any) {
      console.error('Error saving account:', err);
      setError('Erro ao salvar conta. Por favor, tente novamente.');
      setStatus('failed');
    }
  };

  const connectWebSocket = useCallback(async (sid: string) => {
    if (!currentWorkspace) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      // Build WebSocket URL
      const wsUrl = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ws-qr-status`);
      wsUrl.protocol = wsUrl.protocol.replace('http', 'ws');
      wsUrl.searchParams.set('session_id', sid);
      wsUrl.searchParams.set('token', session.access_token);
      wsUrl.searchParams.set('workspace_id', currentWorkspace.id);

      console.log('Connecting to WebSocket:', wsUrl.toString());

      const ws = new WebSocket(wsUrl.toString());
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        if (isMountedRef.current) {
          setStatus('pending');
        }
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;
        
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket message:', data);

          switch (data.status) {
            case 'pending':
              setStatus('pending');
              break;
            case 'qr_updated':
              if (data.qr_code) {
                setQrCode(data.qr_code);
              }
              break;
            case 'connected':
              setStatus('connected');
              saveAccount(data.account_id, data.channel || 'whatsapp', data.name);
              break;
            case 'failed':
              setStatus('failed');
              setError(data.error || 'Falha na conexão.');
              break;
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        if (isMountedRef.current) {
          setStatus('failed');
          setError('Erro na conexão. Por favor, tente novamente.');
        }
      };

      ws.onclose = () => {
        console.log('WebSocket closed');
      };
    } catch (err: any) {
      console.error('Error connecting WebSocket:', err);
      setError('Erro ao conectar. Por favor, tente novamente.');
      setStatus('failed');
    }
  }, [currentWorkspace, onConnected, onOpenChange, toast]);

  const startSession = useCallback(async () => {
    if (!currentWorkspace) return;

    setStatus('loading');
    setError(null);
    setQrCode(null);
    setHostedUrl(null);

    try {
      const { data, error } = await supabase.functions.invoke('create-qr-session', {
        body: {
          workspaceId: currentWorkspace.id,
          channel: 'whatsapp',
        },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      console.log('Session created:', data);

      setSessionId(data.session_id);
      setQrCode(data.qr_code);
      setHostedUrl(data.hosted_url);
      
      // Connect WebSocket for real-time updates
      await connectWebSocket(data.session_id);
    } catch (err: any) {
      console.error('Error starting session:', err);
      setError(err.message || 'Erro ao iniciar sessão.');
      setStatus('failed');
    }
  }, [currentWorkspace, connectWebSocket]);

  useEffect(() => {
    isMountedRef.current = true;
    
    if (open && status === 'idle') {
      startSession();
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [open, status, startSession]);

  useEffect(() => {
    if (!open) {
      cleanup();
      setStatus('idle');
      setQrCode(null);
      setHostedUrl(null);
      setSessionId(null);
      setError(null);
    }
  }, [open, cleanup]);

  const handleRetry = () => {
    cleanup();
    setStatus('idle');
    startSession();
  };

  const renderContent = () => {
    switch (status) {
      case 'loading':
        return (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground">Preparando conexão...</p>
          </div>
        );

      case 'pending':
        return (
          <div className="flex flex-col items-center justify-center py-6 gap-6">
            {hostedUrl ? (
              <>
                <div className="text-center space-y-2">
                  <QrCode className="h-16 w-16 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Clique no botão abaixo para conectar sua conta de mensagens.
                  </p>
                </div>
                <Button onClick={() => window.open(hostedUrl, '_blank')} className="gap-2">
                  <ExternalLink className="h-4 w-4" />
                  Abrir página de conexão
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Aguardando confirmação...
                </p>
              </>
            ) : qrCode ? (
              <>
                <div className="bg-white p-4 rounded-lg">
                  <img 
                    src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                    alt="QR Code"
                    className="w-64 h-64"
                  />
                </div>
                <div className="text-center space-y-2">
                  <p className="font-medium">Escaneie o QR Code</p>
                  <p className="text-sm text-muted-foreground">
                    Abra o app de mensagens no seu celular e escaneie o código para conectar sua conta.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Aguardando leitura...
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Carregando QR Code...</p>
              </div>
            )}
          </div>
        );

      case 'connected':
        return (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <CheckCircle2 className="h-16 w-16 text-primary" />
            <div className="text-center">
              <p className="font-medium text-lg">Conta conectada com sucesso!</p>
              <p className="text-sm text-muted-foreground">
                Sua conta de mensagens foi vinculada ao workspace.
              </p>
            </div>
          </div>
        );

      case 'failed':
        return (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <XCircle className="h-16 w-16 text-destructive" />
            <div className="text-center">
              <p className="font-medium text-lg">Falha na conexão</p>
              <p className="text-sm text-muted-foreground">
                {error || 'Ocorreu um erro ao conectar. Por favor, tente novamente.'}
              </p>
            </div>
            <Button onClick={handleRetry} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Tentar novamente
            </Button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            Conectar Conta de Mensagens
          </DialogTitle>
          <DialogDescription>
            Vincule sua conta para enviar mensagens através da plataforma.
          </DialogDescription>
        </DialogHeader>
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
}
