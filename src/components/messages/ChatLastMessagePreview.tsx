import { Mic, Image, Film, FileText } from 'lucide-react';
import { Chat } from '@/types';

interface ChatLastMessagePreviewProps {
  chat: Chat;
  isTyping: boolean;
}

// Format duration in seconds to mm:ss
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function ChatLastMessagePreview({ chat, isTyping }: ChatLastMessagePreviewProps) {
  // Typing indicator takes priority
  if (isTyping) {
    return <span className="text-primary italic">digitando...</span>;
  }

  // Check for attachment type
  if (chat.last_message_type) {
    switch (chat.last_message_type) {
      case 'audio':
        return (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Mic className="h-3.5 w-3.5 shrink-0" />
            <span>
              {chat.last_message_duration 
                ? formatDuration(chat.last_message_duration)
                : 'Áudio'
              }
            </span>
          </span>
        );
      
      case 'image':
        return (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Image className="h-3.5 w-3.5 shrink-0" />
            <span>Imagem</span>
          </span>
        );
      
      case 'video':
        return (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Film className="h-3.5 w-3.5 shrink-0" />
            <span>Vídeo</span>
          </span>
        );
      
      case 'document':
        return (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span>Documento</span>
          </span>
        );
    }
  }

  // Text message - truncate naturally with CSS
  if (chat.last_message && chat.last_message.trim()) {
    return <span className="truncate">{chat.last_message}</span>;
  }

  // Fallback for empty messages
  return <span className="text-muted-foreground/50">—</span>;
}
