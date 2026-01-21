import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, Download, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

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

  const cacheMedia = useCallback(async () => {
    if (!workspaceId || !messageId || isCaching) return null;
    
    setIsCaching(true);
    console.log('Attempting to cache media...');
    
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
        console.log('Media cached successfully:', response.data.url);
        return response.data.url;
      }
    } catch (err) {
      console.error('Failed to cache media:', err);
    } finally {
      setIsCaching(false);
    }
    
    return null;
  }, [workspaceId, messageId, url, mimeType, isCaching]);

  const handleRetry = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    setRetryCount(prev => prev + 1);
    
    // Try to cache the media
    const cachedUrl = await cacheMedia();
    if (cachedUrl) {
      setAudioUrl(cachedUrl);
    } else {
      setError('Mídia não disponível');
      setIsLoading(false);
    }
  }, [cacheMedia]);

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
      console.log('Audio load error, attempting to cache...');
      
      // Only try to cache once automatically
      if (retryCount === 0) {
        const cachedUrl = await cacheMedia();
        if (cachedUrl) {
          setAudioUrl(cachedUrl);
          setRetryCount(1);
          return;
        }
      }
      
      setError('Áudio expirado');
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
  }, [audioUrl, retryCount, cacheMedia]);

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
      // Try caching on play error
      const cachedUrl = await cacheMedia();
      if (cachedUrl) {
        setAudioUrl(cachedUrl);
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

  const isSent = variant === 'sent';

  if (error) {
    return (
      <div className={cn(
        'flex items-center gap-2 p-2 rounded-lg',
        isSent ? 'text-primary-foreground/70' : 'text-muted-foreground'
      )}>
        <span className="text-xs">🎵 {error}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleRetry}
          disabled={isCaching}
        >
          <RefreshCw className={cn('h-3 w-3', isCaching && 'animate-spin')} />
        </Button>
      </div>
    );
  }

  return (
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

      {audioUrl && (
        <a
          href={audioUrl}
          download={filename || 'audio.ogg'}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'shrink-0 p-1 rounded hover:bg-accent/20',
            isSent ? 'text-primary-foreground/70' : 'text-muted-foreground'
          )}
        >
          <Download className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}