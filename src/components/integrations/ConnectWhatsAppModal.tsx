import { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, QrCode as QrCodeIcon, RefreshCw, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { QRCodeSVG } from 'qrcode.react';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface ConnectWhatsAppModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}

type ConnectionStatus = 'idle' | 'loading' | 'pending' | 'connected' | 'failed' | 'rate_limited';

interface QrSession {
  id: string;
  session_id: string;
  workspace_id: string;
  channel: string;
  status: string;
  qr_code: string | null;
  account_id: string | null;
  account_name: string | null;
  attempts: number;
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
  const [attempts, setAttempts] = useState(0);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isMountedRef = useRef(true);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  const cleanup = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const subscribeToSession = useCallback((sid: string) => {
    if (!currentWorkspace) return;

    console.log('Subscribing to Realtime updates for session:', sid);

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
              toast({
                title: 'Conta conectada com sucesso',
                description: 'Sua conta de mensagens foi vinculada ao workspace.',
              });
              // Give user time to see success state
              setTimeout(() => {
                onConnected();
                onOpenChange(false);
              }, 1500);
              break;
            case 'failed':
            case 'disconnected':
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
  }, [currentWorkspace, status, toast, onConnected, onOpenChange]);

  const startSession = useCallback(async () => {
    if (!currentWorkspace) return;

    setStatus('loading');
    setError(null);
    setQrCode(null);
    setRetryAfter(null);
    cleanup();

    try {
      const { data, error } = await supabase.functions.invoke('create-qr-session', {
        body: {
          workspaceId: currentWorkspace.id,
          channel: 'whatsapp',
        },
      });

      if (error) throw error;
      
      // Check for rate limiting
      if (data.error && data.retry_after) {
        setStatus('rate_limited');
        setError(data.details || data.error);
        setRetryAfter(data.retry_after);
        
        // Start countdown
        countdownRef.current = setInterval(() => {
          setRetryAfter(prev => {
            if (prev && prev > 1) return prev - 1;
            if (countdownRef.current) clearInterval(countdownRef.current);
            return null;
          });
        }, 1000);
        return;
      }
      
      if (data.error) throw new Error(data.error);

      console.log('Session created:', data);

      setSessionId(data.session_id);
      setAttempts(data.attempts || 1);
      setMaxAttempts(data.max_attempts || 3);
      
      if (data.qr_code) {
        setQrCode(data.qr_code);
      }
      
      setStatus('pending');
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
      setAttempts(0);
      setRetryAfter(null);
    }
  }, [open, cleanup]);

  const handleRetry = () => {
    cleanup();
    setStatus('idle');
    startSession();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Detect if QR code is base64 image or raw text
  const isBase64Image = (str: string) => {
    return str.startsWith('data:image') || 
           /^[A-Za-z0-9+/=]+$/.test(str) && str.length > 200 && !str.includes('@');
  };

  const renderQrCode = () => {
    if (!qrCode) {
      return (
        <div className="flex flex-col items-center gap-4 py-8">
          <QrCodeIcon className="h-16 w-16 text-muted-foreground animate-pulse" />
          <p className="text-sm text-muted-foreground">Aguardando QR Code...</p>
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      );
    }

    console.log('QR Code format received:', {
      length: qrCode.length,
      startsWithData: qrCode.startsWith('data:'),
      isBase64: isBase64Image(qrCode),
      preview: qrCode.substring(0, 50) + '...',
    });

    // If it's a base64 image
    if (isBase64Image(qrCode)) {
      const imgSrc = qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`;
      return (
        <div className="bg-white p-4 rounded-lg shadow-sm">
          <img 
            src={imgSrc}
            alt="QR Code"
            className="w-64 h-64"
            onError={(e) => {
              console.error('Failed to load QR image, trying as raw text');
              // If image fails to load, the isBase64Image check was wrong
            }}
          />
        </div>
      );
    }

    // Otherwise, render raw text as QR code using qrcode.react
    console.log('Rendering QR code from raw text');
    return (
      <div className="bg-white p-4 rounded-lg shadow-sm">
        <QRCodeSVG 
          value={qrCode}
          size={256}
          level="M"
          includeMargin={true}
        />
      </div>
    );
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
            {renderQrCode()}
            {qrCode && (
              <>
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
                {attempts > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Tentativa {attempts} de {maxAttempts}
                  </p>
                )}
              </>
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

      case 'rate_limited':
        return (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Clock className="h-16 w-16 text-warning" />
            <div className="text-center">
              <p className="font-medium text-lg">Limite de tentativas atingido</p>
              <p className="text-sm text-muted-foreground">
                {error}
              </p>
            </div>
            {retryAfter && retryAfter > 0 && (
              <div className="text-center">
                <p className="text-2xl font-mono font-bold text-primary">
                  {formatTime(retryAfter)}
                </p>
                <p className="text-xs text-muted-foreground">
                  até poder tentar novamente
                </p>
              </div>
            )}
            {(!retryAfter || retryAfter <= 0) && (
              <Button onClick={handleRetry} variant="outline" className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Tentar novamente
              </Button>
            )}
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
              Gerar novo QR Code
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
            <QrCodeIcon className="h-5 w-5" />
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
