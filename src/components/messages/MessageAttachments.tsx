import { MessageAttachment } from '@/types';
import { AudioPlayer } from './AudioPlayer';
import { FileText, Download, ExternalLink, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

interface MessageAttachmentsProps {
  attachments: MessageAttachment[];
  messageId: string;
  workspaceId: string;
  variant?: 'sent' | 'received';
}

export function MessageAttachments({ attachments, messageId, workspaceId, variant = 'received' }: MessageAttachmentsProps) {
  const isSent = variant === 'sent';
  const [imageErrors, setImageErrors] = useState<Record<number, boolean>>({});
  const [cachingIndex, setCachingIndex] = useState<number | null>(null);

  const handleImageError = useCallback(async (index: number, attachment: MessageAttachment) => {
    setImageErrors(prev => ({ ...prev, [index]: true }));
  }, []);

  const handleCacheImage = useCallback(async (index: number, attachment: MessageAttachment) => {
    setCachingIndex(index);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await supabase.functions.invoke('cache-media', {
        body: {
          workspaceId,
          mediaUrl: attachment.url,
          messageId: `${messageId}-${index}`,
          mediaType: attachment.type,
          mimeType: attachment.mime_type || 'image/jpeg',
        },
      });

      if (response.data?.success && response.data?.url) {
        // Force reload by updating the attachment URL
        window.location.reload();
      }
    } catch (err) {
      console.error('Failed to cache image:', err);
    } finally {
      setCachingIndex(null);
    }
  }, [workspaceId, messageId]);

  return (
    <div className="space-y-2">
      {attachments.map((attachment, index) => {
        switch (attachment.type) {
          case 'audio':
            return (
              <AudioPlayer
                key={index}
                url={attachment.url}
                messageId={messageId}
                workspaceId={workspaceId}
                duration={attachment.duration}
                filename={attachment.filename}
                mimeType={attachment.mime_type}
                variant={variant}
              />
            );

          case 'image':
            if (imageErrors[index]) {
              return (
                <div
                  key={index}
                  className={cn(
                    'flex items-center gap-2 p-3 rounded-lg',
                    isSent ? 'bg-primary-foreground/10' : 'bg-muted'
                  )}
                >
                  <span className="text-sm">🖼️ Imagem expirada</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCacheImage(index, attachment)}
                    disabled={cachingIndex === index}
                  >
                    <RefreshCw className={cn('h-4 w-4', cachingIndex === index && 'animate-spin')} />
                  </Button>
                </div>
              );
            }
            return (
              <a
                key={index}
                href={attachment.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <img
                  src={attachment.url}
                  alt={attachment.filename || 'Imagem'}
                  className="max-w-[240px] max-h-[300px] rounded-lg object-cover"
                  loading="lazy"
                  onError={() => handleImageError(index, attachment)}
                />
              </a>
            );

          case 'video':
            return (
              <video
                key={index}
                src={attachment.url}
                controls
                className="max-w-[280px] max-h-[300px] rounded-lg"
                preload="metadata"
              />
            );

          case 'document':
          case 'file':
          default:
            return (
              <a
                key={index}
                href={attachment.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'flex items-center gap-2 p-2 rounded-lg transition-colors',
                  isSent 
                    ? 'bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground' 
                    : 'bg-background/50 hover:bg-background/80'
                )}
              >
                <FileText className="h-5 w-5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">
                    {attachment.filename || 'Documento'}
                  </p>
                  {attachment.size && (
                    <p className={cn(
                      'text-xs',
                      isSent ? 'text-primary-foreground/60' : 'text-muted-foreground'
                    )}>
                      {formatFileSize(attachment.size)}
                    </p>
                  )}
                </div>
                <ExternalLink className="h-4 w-4 shrink-0 opacity-50" />
              </a>
            );
        }
      })}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}