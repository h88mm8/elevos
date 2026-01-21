import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, Download, Loader2, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAudioTranscription } from '@/hooks/useAudioTranscription';

interface AudioPlayerProps {
  url: string;
  messageId: string;
  workspaceId: string;
  duration?: number;
  filename?: string;
  mimeType?: string;
  variant?: 'sent' | 'received';
}

export function AudioPlayer({ 
  url, 
  messageId,
  workspaceId,
  duration, 
  filename, 
  mimeType,
  variant = 'received' 
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState(url);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(duration || 0);
  const [isLoading, setIsLoading] = useState(true);
  const [isCaching, setIsCaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showTranscription, setShowTranscription] = useState(false);

  // Transcription hook - only for received messages
  const isReceived = variant === 'received';
  const { 
    text: transcriptionText, 
    status: transcriptionStatus, 
    progress: transcriptionProgress,
    error: transcriptionError,
    transcribe,
    reset: resetTranscription 
  } = useAudioTranscription();

  // Check if URL is already from storage (cached)
  const isStorageUrl = useCallback((testUrl: string) => {
    return testUrl.includes('supabase') && testUrl.includes('storage');
  }, []);

  const cacheMedia = useCallback(async () => {
    if (!workspaceId || !messageId || isCaching) return null;
    
    setIsCaching(true);
    console.log('Attempting to cache audio...');
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.error('No session for caching');
        return null;
      }

      const response = await supabase.functions.invoke('cache-media', {
        body: {
          workspaceId,
          mediaUrl: url,
          messageId,
          mediaType: 'audio',
          mimeType: mimeType || 'audio/ogg',
        },
      });

      if (response.error) {
        console.error('Cache error:', response.error);
        return null;
      }

      if (response.data?.success && response.data?.url) {
        console.log('Audio cached successfully:', response.data.url);
        return response.data.url;
      }
    } catch (err) {
      console.error('Failed to cache audio:', err);
    } finally {
      setIsCaching(false);
    }
    
    return null;
  }, [workspaceId, messageId, url, mimeType, isCaching]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setAudioDuration(audio.duration);
      setIsLoading(false);
      setError(null);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handleCanPlay = () => {
      setIsLoading(false);
      setError(null);
    };

    const handleError = async () => {
      console.log('Audio load error, retryCount:', retryCount);
      
      // Only try to cache once automatically
      if (retryCount === 0 && !isStorageUrl(audioUrl)) {
        setRetryCount(1);
        const cachedUrl = await cacheMedia();
        if (cachedUrl) {
          setAudioUrl(cachedUrl);
          return;
        }
      }
      
      setError('Áudio não disponível');
      setIsLoading(false);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('error', handleError);
    };
  }, [audioUrl, retryCount, cacheMedia, isStorageUrl]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      if (isPlaying) {
        audio.pause();
      } else {
        await audio.play();
      }
      setIsPlaying(!isPlaying);
    } catch (err) {
      console.error('Error playing audio:', err);
      // Try caching on play error if not already a storage URL
      if (!isStorageUrl(audioUrl)) {
        const cachedUrl = await cacheMedia();
        if (cachedUrl) {
          setAudioUrl(cachedUrl);
        } else {
          setError('Erro ao reproduzir');
        }
      } else {
        setError('Erro ao reproduzir');
      }
    }
  };

  const handleSeek = (value: number[]) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value[0];
    setCurrentTime(value[0]);
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Download via fetch blob to prevent redirect
  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (isDownloading) return;
    
    setIsDownloading(true);
    
    try {
      const response = await fetch(audioUrl);
      if (!response.ok) throw new Error('Download failed');
      
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename || `audio-${messageId}.ogg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      console.error('Download error:', err);
      // Fallback: open in new tab
      window.open(audioUrl, '_blank');
    } finally {
      setIsDownloading(false);
    }
  };

  const isSent = variant === 'sent';

  // Handle transcription toggle
  const handleTranscriptionToggle = useCallback(async () => {
    if (!isReceived) return;
    
    if (showTranscription) {
      setShowTranscription(false);
      return;
    }
    
    setShowTranscription(true);
    
    // Only transcribe if we haven't already
    if (transcriptionStatus === 'idle') {
      await transcribe(audioUrl);
    }
  }, [isReceived, showTranscription, transcriptionStatus, transcribe, audioUrl]);

  if (error) {
    return (
      <div className={cn(
        'flex items-center gap-2 p-2 rounded-lg',
        isSent ? 'text-primary-foreground/70' : 'text-muted-foreground'
      )}>
        <span className="text-xs">🎵 {error}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className={cn(
        'flex items-center gap-2 min-w-[200px] max-w-[280px]',
      )}>
        <audio ref={audioRef} src={audioUrl} preload="metadata" crossOrigin="anonymous" />
        
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-10 w-10 rounded-full shrink-0',
            isSent 
              ? 'hover:bg-primary-foreground/20 text-primary-foreground' 
              : 'hover:bg-muted-foreground/20'
          )}
          onClick={togglePlay}
          disabled={isLoading || isCaching}
        >
          {isLoading || isCaching ? (
            <div className={cn(
              'h-4 w-4 animate-pulse rounded-full',
              isSent ? 'bg-primary-foreground/50' : 'bg-muted-foreground/50'
            )} />
          ) : isPlaying ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5 ml-0.5" />
          )}
        </Button>

        <div className="flex-1 flex flex-col gap-1">
          <Slider
            value={[currentTime]}
            max={audioDuration || 100}
            step={0.1}
            onValueChange={handleSeek}
            disabled={isLoading || isCaching}
            className={cn(
              'w-full',
              isSent && '[&_[role=slider]]:bg-primary-foreground [&_[role=slider]]:border-primary-foreground [&_.range]:bg-primary-foreground/70'
            )}
          />
          <div className={cn(
            'flex justify-between text-xs',
            isSent ? 'text-primary-foreground/70' : 'text-muted-foreground'
          )}>
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(audioDuration)}</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Transcription button - only for received messages */}
          {isReceived && (
            <button
              onClick={handleTranscriptionToggle}
              disabled={transcriptionStatus === 'loading-model' || transcriptionStatus === 'transcribing'}
              className={cn(
                'shrink-0 p-1 rounded hover:bg-accent/20 disabled:opacity-50 text-muted-foreground',
                showTranscription && 'bg-accent/20'
              )}
              title={showTranscription ? 'Ocultar transcrição' : 'Transcrever áudio'}
            >
              {transcriptionStatus === 'loading-model' || transcriptionStatus === 'transcribing' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
            </button>
          )}

          {audioUrl && (
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className={cn(
                'shrink-0 p-1 rounded hover:bg-accent/20 disabled:opacity-50',
                isSent ? 'text-primary-foreground/70' : 'text-muted-foreground'
              )}
              title="Baixar áudio"
            >
              {isDownloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Transcription panel */}
      {isReceived && showTranscription && (
        <div className="pl-12 pr-2">
          <div className="bg-muted/50 rounded-lg p-2 text-sm">
            {transcriptionStatus === 'loading-model' && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Carregando modelo ({transcriptionProgress}%)...</span>
              </div>
            )}
            {transcriptionStatus === 'transcribing' && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Transcrevendo...</span>
              </div>
            )}
            {transcriptionStatus === 'error' && (
              <div className="text-destructive text-xs">
                {transcriptionError || 'Erro na transcrição'}
              </div>
            )}
            {transcriptionStatus === 'done' && (
              <p className="text-foreground whitespace-pre-wrap">
                {transcriptionText || <span className="text-muted-foreground italic">Sem fala detectada</span>}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
