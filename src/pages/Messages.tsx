import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  MessageSquare, 
  Send, 
  Loader2,
  User,
  Search,
  ChevronUp,
  Paperclip,
  X,
  Image,
  FileText,
  Film,
  Music
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Chat, Message } from '@/types';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'video/mp4', 'audio/mpeg', 'audio/ogg'
];

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return Image;
  if (mimeType.startsWith('video/')) return Film;
  if (mimeType.startsWith('audio/')) return Music;
  return FileText;
}

export default function Messages() {
  const { currentWorkspace } = useAuth();
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesTopRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [typingChats, setTypingChats] = useState<Record<string, boolean>>({});
  
  // Attachment state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Subscribe to typing events
  useEffect(() => {
    if (!currentWorkspace) return;

    const channel = supabase.channel(`typing:${currentWorkspace.id}`)
      .on('broadcast', { event: 'typing' }, (payload) => {
        const { chat_id, is_typing } = payload.payload;
        setTypingChats(prev => ({
          ...prev,
          [chat_id]: is_typing,
        }));

        // Auto-clear typing indicator after 5 seconds
        if (is_typing) {
          setTimeout(() => {
            setTypingChats(prev => ({
              ...prev,
              [chat_id]: false,
            }));
          }, 5000);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentWorkspace]);

  useEffect(() => {
    if (currentWorkspace) {
      fetchChats();
    }
  }, [currentWorkspace]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length > 0 && messages[messages.length - 1]?.id]);

  // Cleanup file preview URL
  useEffect(() => {
    return () => {
      if (filePreview) {
        URL.revokeObjectURL(filePreview);
      }
    };
  }, [filePreview]);

  async function fetchChats() {
    setLoadingChats(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-chats', {
        body: { workspaceId: currentWorkspace.id },
      });

      if (error) throw error;

      setChats(data.chats || []);
    } catch (error: any) {
      console.error('Error fetching chats:', error);
    } finally {
      setLoadingChats(false);
    }
  }

  async function fetchMessages(chatId: string, beforeCursor?: string) {
    if (beforeCursor) {
      setLoadingOlder(true);
    } else {
      setLoadingMessages(true);
      setMessages([]);
      setCursor(null);
      setHasMore(true);
    }

    try {
      const { data, error } = await supabase.functions.invoke('get-chat-messages', {
        body: { 
          workspaceId: currentWorkspace?.id, 
          chatId,
          limit: 50,
          before: beforeCursor,
        },
      });

      if (error) throw error;

      const newMessages = data.messages || [];
      
      if (beforeCursor) {
        // Prepend older messages
        setMessages(prev => [...newMessages, ...prev]);
      } else {
        setMessages(newMessages);
      }
      
      setCursor(data.cursor || null);
      setHasMore(!!data.cursor && newMessages.length > 0);
    } catch (error: any) {
      toast({
        title: 'Erro ao carregar mensagens',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoadingMessages(false);
      setLoadingOlder(false);
    }
  }

  const loadOlderMessages = useCallback(() => {
    if (!selectedChat || !cursor || loadingOlder || !hasMore) return;
    fetchMessages(selectedChat.id, cursor);
  }, [selectedChat, cursor, loadingOlder, hasMore]);

  function handleSelectChat(chat: Chat) {
    setSelectedChat(chat);
    fetchMessages(chat.id);
    // Clear any selected file when changing chats
    clearSelectedFile();
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast({
        title: 'Tipo de arquivo não suportado',
        description: 'Apenas imagens (JPEG, PNG, GIF, WebP), PDFs, vídeos (MP4) e áudios (MP3, OGG) são permitidos.',
        variant: 'destructive',
      });
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      toast({
        title: 'Arquivo muito grande',
        description: 'O tamanho máximo é 10MB.',
        variant: 'destructive',
      });
      return;
    }

    setSelectedFile(file);
    
    // Create preview for images
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setFilePreview(url);
    } else {
      setFilePreview(null);
    }
  }

  function clearSelectedFile() {
    if (filePreview) {
      URL.revokeObjectURL(filePreview);
    }
    setSelectedFile(null);
    setFilePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function handleSendMessage() {
    if ((!newMessage.trim() && !selectedFile) || !selectedChat) return;

    const messageText = newMessage;
    setNewMessage('');
    setSending(true);

    // Optimistic update
    const tempMessage: Message = {
      id: 'temp-' + Date.now(),
      chat_id: selectedChat.id,
      sender: 'me',
      text: messageText || (selectedFile ? `📎 ${selectedFile.name}` : ''),
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempMessage]);

    try {
      let attachmentUrl: string | undefined;
      let attachmentType: string | undefined;
      let attachmentName: string | undefined;

      // Upload file if selected
      if (selectedFile && currentWorkspace) {
        setUploading(true);
        
        const fileExt = selectedFile.name.split('.').pop();
        const fileName = `${crypto.randomUUID()}.${fileExt}`;
        const filePath = `${currentWorkspace.id}/${selectedChat.id}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('message-attachments')
          .upload(filePath, selectedFile);

        if (uploadError) throw uploadError;

        // Get a signed URL for the file (valid for 1 hour)
        const { data: signedUrlData, error: signedUrlError } = await supabase.storage
          .from('message-attachments')
          .createSignedUrl(filePath, 3600);

        if (signedUrlError) throw signedUrlError;

        attachmentUrl = signedUrlData.signedUrl;
        attachmentType = selectedFile.type;
        attachmentName = selectedFile.name;
        
        setUploading(false);
        clearSelectedFile();
      }

      const { data, error } = await supabase.functions.invoke('send-message', {
        body: {
          workspaceId: currentWorkspace?.id,
          chatId: selectedChat.id,
          text: messageText || undefined,
          attachmentUrl,
          attachmentType,
          attachmentName,
        },
      });

      if (error) throw error;

      // Replace temp message with real one
      setMessages(prev => prev.map(m => 
        m.id === tempMessage.id 
          ? { ...m, id: data.messageId || m.id }
          : m
      ));
    } catch (error: any) {
      // Remove temp message on error
      setMessages(prev => prev.filter(m => m.id !== tempMessage.id));
      toast({
        title: 'Erro ao enviar mensagem',
        description: error.message,
        variant: 'destructive',
      });
      setUploading(false);
    } finally {
      setSending(false);
    }
  }

  const filteredChats = chats.filter(chat => 
    (chat.attendee_name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
    (chat.attendee_email?.toLowerCase() || '').includes(searchQuery.toLowerCase())
  );

  const FileIcon = selectedFile ? getFileIcon(selectedFile.type) : FileText;

  return (
    <AppLayout>
      <div className="h-[calc(100vh-8rem)]">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-full">
          {/* Chat List */}
          <Card className="md:col-span-1 flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Conversas</CardTitle>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar conversas..."
                  className="pl-9"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full">
                {loadingChats ? (
                  <div className="space-y-2 p-4">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : filteredChats.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground px-4">
                    <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhuma conversa encontrada.</p>
                    <p className="text-sm">As conversas aparecerão aqui após enviar campanhas.</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredChats.map((chat) => (
                      <button
                        key={chat.id}
                        onClick={() => handleSelectChat(chat)}
                        className={cn(
                          'w-full text-left p-4 hover:bg-muted transition-colors',
                          selectedChat?.id === chat.id && 'bg-muted'
                        )}
                      >
                        <div className="flex items-start gap-3">
                          {chat.attendee_picture ? (
                            <img 
                              src={chat.attendee_picture} 
                              alt={chat.attendee_name}
                              className="h-10 w-10 rounded-full object-cover shrink-0"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.nextElementSibling?.classList.remove('hidden');
                              }}
                            />
                          ) : null}
                          <div className={cn(
                            "h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0",
                            chat.attendee_picture && "hidden"
                          )}>
                            <User className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <p className="font-medium truncate">{chat.attendee_name}</p>
                              {chat.unread_count > 0 && (
                                <span className="bg-primary text-primary-foreground text-xs rounded-full px-2 py-0.5">
                                  {chat.unread_count}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground truncate">
                              {typingChats[chat.id] ? (
                                <span className="text-primary italic">digitando...</span>
                              ) : (
                                chat.last_message
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {chat.last_message_at && !isNaN(new Date(chat.last_message_at).getTime()) 
                                ? format(new Date(chat.last_message_at), 'dd/MM HH:mm', { locale: ptBR })
                                : '—'}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Messages */}
          <Card className="md:col-span-2 flex flex-col">
            {selectedChat ? (
              <>
                <CardHeader className="pb-3 border-b">
                  <div className="flex items-center gap-3">
                    {selectedChat.attendee_picture ? (
                      <img 
                        src={selectedChat.attendee_picture} 
                        alt={selectedChat.attendee_name}
                        className="h-10 w-10 rounded-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          e.currentTarget.nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    <div className={cn(
                      "h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center",
                      selectedChat.attendee_picture && "hidden"
                    )}>
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{selectedChat.attendee_name}</CardTitle>
                      {typingChats[selectedChat.id] ? (
                        <p className="text-sm text-primary italic animate-pulse">digitando...</p>
                      ) : selectedChat.attendee_email ? (
                        <p className="text-sm text-muted-foreground">{selectedChat.attendee_email}</p>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden p-0">
                  <ScrollArea className="h-full p-4" ref={scrollAreaRef}>
                    {loadingMessages ? (
                      <div className="space-y-4">
                        {[1, 2, 3].map((i) => (
                          <Skeleton key={i} className="h-16 w-3/4" />
                        ))}
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <p>Nenhuma mensagem ainda.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Load older messages button */}
                        {hasMore && (
                          <div ref={messagesTopRef} className="flex justify-center py-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={loadOlderMessages}
                              disabled={loadingOlder}
                              className="text-muted-foreground"
                            >
                              {loadingOlder ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              ) : (
                                <ChevronUp className="h-4 w-4 mr-2" />
                              )}
                              {loadingOlder ? 'Carregando...' : 'Carregar mensagens anteriores'}
                            </Button>
                          </div>
                        )}
                        
                        {messages.map((msg) => (
                          <div
                            key={msg.id}
                            className={cn(
                              'flex',
                              msg.sender === 'me' ? 'justify-end' : 'justify-start'
                            )}
                          >
                            <div
                              className={cn(
                                'max-w-[70%] rounded-lg px-4 py-2',
                                msg.sender === 'me'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted'
                              )}
                            >
                              <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                              <p className={cn(
                                'text-xs mt-1',
                                msg.sender === 'me' ? 'text-primary-foreground/70' : 'text-muted-foreground'
                              )}>
                                {msg.timestamp && !isNaN(new Date(msg.timestamp).getTime())
                                  ? format(new Date(msg.timestamp), 'HH:mm', { locale: ptBR })
                                  : '—'}
                              </p>
                            </div>
                          </div>
                        ))}
                        <div ref={messagesEndRef} />
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
                <div className="p-4 border-t space-y-2">
                  {/* File preview */}
                  {selectedFile && (
                    <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                      {filePreview ? (
                        <img 
                          src={filePreview} 
                          alt="Preview" 
                          className="h-16 w-16 object-cover rounded"
                        />
                      ) : (
                        <div className="h-16 w-16 bg-background rounded flex items-center justify-center">
                          <FileIcon className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{selectedFile.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {(selectedFile.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={clearSelectedFile}
                        disabled={sending}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                  
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSendMessage();
                    }}
                    className="flex gap-2"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ALLOWED_TYPES.join(',')}
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={sending || uploading}
                    >
                      <Paperclip className="h-4 w-4" />
                    </Button>
                    <Input
                      placeholder="Digite sua mensagem..."
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      disabled={sending}
                    />
                    <Button type="submit" disabled={sending || uploading || (!newMessage.trim() && !selectedFile)}>
                      {sending || uploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </form>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Selecione uma conversa para ver as mensagens</p>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
