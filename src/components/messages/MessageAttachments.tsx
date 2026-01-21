import { MessageAttachment } from '@/types';
import { AudioPlayer } from './AudioPlayer';
import { FileText, Download, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MessageAttachmentsProps {
  attachments: MessageAttachment[];
  variant?: 'sent' | 'received';
}

export function MessageAttachments({ attachments, variant = 'received' }: MessageAttachmentsProps) {
  const isSent = variant === 'sent';

  return (
    <div className="space-y-2">
      {attachments.map((attachment, index) => {
        switch (attachment.type) {
          case 'audio':
            return (
              <AudioPlayer
                key={index}
                url={attachment.url}
                duration={attachment.duration}
                filename={attachment.filename}
                variant={variant}
              />
            );

          case 'image':
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