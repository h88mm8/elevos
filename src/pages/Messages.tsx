import { useState, useEffect, useRef } from 'react';
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
  Search
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Chat, Message } from '@/types';

export default function Messages() {
  const { currentWorkspace } = useAuth();
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (currentWorkspace) {
      fetchChats();
    }
  }, [currentWorkspace]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      // Don't show error toast, just show empty state
    } finally {
      setLoadingChats(false);
    }
  }

  async function fetchMessages(chatId: string) {
    setLoadingMessages(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-chat-messages', {
        body: { workspaceId: currentWorkspace?.id, chatId },
      });

      if (error) throw error;

      setMessages(data.messages || []);
    } catch (error: any) {
      toast({
        title: 'Erro ao carregar mensagens',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoadingMessages(false);
    }
  }

  function handleSelectChat(chat: Chat) {
    setSelectedChat(chat);
    fetchMessages(chat.id);
  }

  async function handleSendMessage() {
    if (!newMessage.trim() || !selectedChat) return;

    const messageText = newMessage;
    setNewMessage('');
    setSending(true);

    // Optimistic update
    const tempMessage: Message = {
      id: 'temp-' + Date.now(),
      chat_id: selectedChat.id,
      sender: 'me',
      text: messageText,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempMessage]);

    try {
      const { data, error } = await supabase.functions.invoke('send-message', {
        body: {
          workspaceId: currentWorkspace?.id,
          chatId: selectedChat.id,
          text: messageText,
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
    } finally {
      setSending(false);
    }
  }

  const filteredChats = chats.filter(chat => 
    chat.attendee_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    chat.attendee_email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
                          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
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
                              {chat.last_message}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {format(new Date(chat.last_message_at), 'dd/MM HH:mm', { locale: ptBR })}
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
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{selectedChat.attendee_name}</CardTitle>
                      {selectedChat.attendee_email && (
                        <p className="text-sm text-muted-foreground">{selectedChat.attendee_email}</p>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden p-0">
                  <ScrollArea className="h-full p-4">
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
                                {format(new Date(msg.timestamp), 'HH:mm', { locale: ptBR })}
                              </p>
                            </div>
                          </div>
                        ))}
                        <div ref={messagesEndRef} />
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
                <div className="p-4 border-t">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSendMessage();
                    }}
                    className="flex gap-2"
                  >
                    <Input
                      placeholder="Digite sua mensagem..."
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      disabled={sending}
                    />
                    <Button type="submit" disabled={sending || !newMessage.trim()}>
                      {sending ? (
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
