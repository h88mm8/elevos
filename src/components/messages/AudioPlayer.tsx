import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, Download } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AudioPlayerProps {
  url: string;
  duration?: number;
  filename?: string;
  variant?: 'sent' | 'received';
}

export function AudioPlayer({ url, duration, filename, variant = 'received' }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(duration || 0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setAudioDuration(audio.duration);
      setIsLoading(false);
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
    };

    const handleError = () => {
      setError('Erro ao carregar áudio');
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
  }, []);

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
      setError('Erro ao reproduzir áudio');
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
        'flex items-center gap-2 p-2 rounded-lg text-xs',
        isSent ? 'text-primary-foreground/70' : 'text-muted-foreground'
      )}>
        <span>🎵 Áudio indisponível</span>
      </div>
    );
  }

  return (
    <div className={cn(
      'flex items-center gap-2 min-w-[200px] max-w-[280px]',
    )}>
      <audio ref={audioRef} src={url} preload="metadata" />
      
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
        disabled={isLoading}
      >
        {isLoading ? (
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
          disabled={isLoading}
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

      {filename && (
        <a
          href={url}
          download={filename}
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