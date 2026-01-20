import { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, QrCode, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface ConnectWhatsAppModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}

type ConnectionStatus = 'idle' | 'loading' | 'pending' | 'connected' | 'failed';

interface QrSession {
  id: string;
  session_id: string;
  workspace_id: string;
  channel: string;
  status: string;
  qr_code: string | null;
  account_id: string | null;
  account_name: string | null;
  error: string | null;
  expires_at: string;
}

export default function ConnectWhatsAppModal({ 
  open, 
  onOpenChange, 
  onConnected 
}: ConnectWhatsAppModalProps) {
  const { currentWorkspace } = useAuth();
  const { toast } = useToast();
  
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isMountedRef = useRef(true);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const cleanup = useCallback(() => {
    // Unsubscribe from Realtime channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    // Clear timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const saveAccount = async (accountId: string, channel: string, name?: string) => {
    try {
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

  const subscribeToSession = useCallback((sid: string) => {
    if (!currentWorkspace) return;

    console.log('Subscribing to Realtime updates for session:', sid);

    // Subscribe to changes on the qr_sessions table for this session
    const channel = supabase
      .channel(`qr-session-${sid}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'qr_sessions',
          filter: `session_id=eq.${sid}`,
        },
        (payload) => {
          if (!isMountedRef.current) return;
          
          const newData = payload.new as QrSession;
          console.log('Realtime update received:', newData);

          switch (newData.status) {
            case 'pending':
              setStatus('pending');
              break;
            case 'qr_updated':
              if (newData.qr_code) {
                setQrCode(newData.qr_code);
              }
              setStatus('pending');
              break;
            case 'connected':
              setStatus('connected');
              if (newData.account_id) {
                saveAccount(
                  newData.account_id, 
                  newData.channel || 'whatsapp', 
                  newData.account_name || undefined
                );
              }
              break;
            case 'failed':
              setStatus('failed');
              setError(newData.error || 'Falha na conexão.');
              break;
          }
        }
      )
      .subscribe((status) => {
        console.log('Realtime subscription status:', status);
      });

    channelRef.current = channel;

    // Set session expiration timeout (10 minutes)
    timeoutRef.current = setTimeout(() => {
      if (isMountedRef.current && status === 'pending') {
        setStatus('failed');
        setError('Sessão expirada. Por favor, tente novamente.');
      }
    }, 10 * 60 * 1000);
  }, [currentWorkspace, status]);

  const startSession = useCallback(async () => {
    if (!currentWorkspace) return;

    setStatus('loading');
    setError(null);
    setQrCode(null);
    cleanup();

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
      
      // Set initial QR code if available
      if (data.qr_code) {
        setQrCode(data.qr_code);
      }
      
      setStatus('pending');
      
      // Subscribe to Realtime updates for this session
      subscribeToSession(data.session_id);
    } catch (err: any) {
      console.error('Error starting session:', err);
      setError(err.message || 'Erro ao iniciar sessão.');
      setStatus('failed');
    }
  }, [currentWorkspace, cleanup, subscribeToSession]);

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
            {qrCode ? (
              <>
                <div className="bg-white p-4 rounded-lg shadow-sm">
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
              <div className="flex flex-col items-center gap-4 py-8">
                <QrCode className="h-16 w-16 text-muted-foreground animate-pulse" />
                <p className="text-sm text-muted-foreground">Carregando QR Code...</p>
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
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
