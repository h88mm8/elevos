import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useNotificationSettings } from '@/hooks/useNotificationSettings';
import { useMediaPreCache } from '@/hooks/useMediaPreCache';
import { supabase } from '@/integrations/supabase/client';
import { MessageAttachments } from '@/components/messages/MessageAttachments';
import { VoiceRecorder } from '@/components/messages/VoiceRecorder';
import { 
  MessageSquare, 
  Send, 
  Loader2,
  User,
  Search,
  ChevronUp,
  ChevronDown,
  Paperclip,
  X,
  Image,
  FileText,
  Film,
  Music,
  Check,
  CheckCheck,
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

// Message status indicator component
function MessageStatus({ status }: { status?: Message['status'] }) {
  if (!status) return null;
  
  switch (status) {
    case 'sending':
      return <Loader2 className="h-3 w-3 animate-spin text-primary-foreground/70" />;
    case 'sent':
      return <Check className="h-3 w-3 text-primary-foreground/70" />;
    case 'delivered':
      return <CheckCheck className="h-3 w-3 text-primary-foreground/70" />;
    case 'read':
      return <CheckCheck className="h-3 w-3 text-accent" />;
    default:
      return null;
  }
}

// Highlight matching text in a message
function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  
  return parts.map((part, i) => 
    regex.test(part) ? (
      <mark key={i} className="bg-accent text-accent-foreground rounded px-0.5">
        {part}
      </mark>
    ) : part
  );
}

export default function Messages() {
  const { currentWorkspace, session } = useAuth();
  const { toast } = useToast();
  const { soundEnabled, filterByLeads } = useNotificationSettings();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesTopRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  
  // Refs for realtime subscription (avoid re-subscribing on state changes)
  const chatsRef = useRef<Chat[]>([]);
  const selectedChatRef = useRef<Chat | null>(null);
  const isScrolledToBottomRef = useRef(true);
  const soundEnabledRef = useRef(true);

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
  
  // Leads phone numbers for filtering
  const [leadsPhoneNumbers, setLeadsPhoneNumbers] = useState<Set<string>>(new Set());
  const [loadingLeads, setLoadingLeads] = useState(false);
  
  // Attachment state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  
  // Audio recording state
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  
  // Message search state
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [messageSearchActive, setMessageSearchActive] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  
  // New messages indicator state
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Keep refs in sync with state for realtime callbacks
  useEffect(() => { chatsRef.current = chats; }, [chats]);
  useEffect(() => { selectedChatRef.current = selectedChat; }, [selectedChat]);
  useEffect(() => { isScrolledToBottomRef.current = isScrolledToBottom; }, [isScrolledToBottom]);
  useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);

  // Pre-cache media in background when messages load
  useMediaPreCache({
    workspaceId: currentWorkspace?.id || '',
    messages,
    enabled: !!currentWorkspace && messages.length > 0,
  });

  // Play notification sound
  const playNotificationSound = useCallback(() => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      
      // Create a pleasant notification beep
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      oscillator.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.3);
    } catch (e) {
      // Silently fail if audio is not supported
      console.warn('Audio notification not supported:', e);
    }
  }, []);

  // Track scroll position
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 100;
    setIsScrolledToBottom(isAtBottom);
    
    // Clear new messages indicator when scrolled to bottom
    if (isAtBottom && hasNewMessages) {
      setHasNewMessages(false);
    }
  }, [hasNewMessages]);

  // Scroll to bottom and clear indicator
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setHasNewMessages(false);
  }, []);

  // Find matching messages
  const matchingMessages = useMemo(() => {
    if (!messageSearchQuery.trim()) return [];
    const query = messageSearchQuery.toLowerCase();
    return messages
      .filter(msg => msg.text?.toLowerCase().includes(query))
      .map(msg => msg.id);
  }, [messages, messageSearchQuery]);

  // Navigate to a specific match
  const navigateToMatch = useCallback((index: number) => {
    if (matchingMessages.length === 0) return;
    const clampedIndex = Math.max(0, Math.min(index, matchingMessages.length - 1));
    setCurrentMatchIndex(clampedIndex);
    
    const messageId = matchingMessages[clampedIndex];
    const element = messageRefs.current.get(messageId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [matchingMessages]);

  const goToNextMatch = useCallback(() => {
    navigateToMatch((currentMatchIndex + 1) % matchingMessages.length);
  }, [currentMatchIndex, matchingMessages.length, navigateToMatch]);

  const goToPrevMatch = useCallback(() => {
    navigateToMatch((currentMatchIndex - 1 + matchingMessages.length) % matchingMessages.length);
  }, [currentMatchIndex, matchingMessages.length, navigateToMatch]);

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

  // Subscribe to new messages via Supabase Realtime
  // Using refs to avoid re-subscribing on every state change
  // Process both 'me' and 'them' messages for real-time sync
  useEffect(() => {
    if (!currentWorkspace) return;

    const channel = supabase.channel(`messages:${currentWorkspace.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `workspace_id=eq.${currentWorkspace.id}`,
        },
        (payload) => {
          const newMessage = payload.new as any;
          const isSenderMe = newMessage.sender === 'me';
          const isViewingThisChat = selectedChatRef.current?.id === newMessage.chat_id;
          
          console.log(`Realtime message: sender=${newMessage.sender}, chat=${newMessage.chat_id}, viewing=${isViewingThisChat}`);
          
          // Notify only for messages from others
          if (!isSenderMe) {
            // Find the chat for this message using ref
            const chat = chatsRef.current.find(c => c.id === newMessage.chat_id);
            const senderName = chat?.attendee_name || 'Novo contato';
            
            // Play notification sound if enabled (using ref) and not viewing this chat
            if (soundEnabledRef.current && !isViewingThisChat) {
              playNotificationSound();
            }
            
            // Show toast notification only if not viewing this chat
            if (!isViewingThisChat) {
              toast({
                title: senderName,
                description: newMessage.text?.slice(0, 100) || '📎 Anexo recebido',
              });
            }
          }
          
          // Update chat list for both sender types
          setChats(prev => prev.map(c => 
            c.id === newMessage.chat_id 
              ? { 
                  ...c, 
                  // Only increment unread for 'them' messages and only if not viewing
                  unread_count: (!isSenderMe && !isViewingThisChat) ? (c.unread_count || 0) + 1 : c.unread_count,
                  last_message: newMessage.text || '📎 Anexo',
                  last_message_at: newMessage.timestamp || new Date().toISOString(),
                }
              : c
          ));
          
          // If viewing this chat, add message to the list (for both 'me' and 'them')
          if (isViewingThisChat) {
            // Parse attachments from the database payload
            let attachments: Message['attachments'] = undefined;
            if (newMessage.attachments) {
              try {
                const parsed = typeof newMessage.attachments === 'string' 
                  ? JSON.parse(newMessage.attachments) 
                  : newMessage.attachments;
                if (Array.isArray(parsed) && parsed.length > 0) {
                  attachments = parsed;
                }
              } catch (e) {
                console.warn('Failed to parse attachments:', e);
              }
            }
            
            const mappedMessage: Message = {
              id: newMessage.id,
              chat_id: newMessage.chat_id,
              sender: isSenderMe ? 'me' : 'them',
              text: newMessage.text || '',
              timestamp: newMessage.timestamp || newMessage.created_at,
              attachments,
              // For 'me' messages from webhook, mark as sent
              status: isSenderMe ? 'sent' : undefined,
            };
            
            setMessages(prev => {
              // Avoid duplicates (check by id and external_id pattern)
              if (prev.some(m => m.id === mappedMessage.id)) return prev;
              // Also check if we have a temp message with similar content
              const hasSimilarTempMessage = prev.some(m => 
                m.id.startsWith('temp-') && 
                m.sender === 'me' && 
                m.text === mappedMessage.text &&
                Math.abs(new Date(m.timestamp).getTime() - new Date(mappedMessage.timestamp).getTime()) < 5000
              );
              if (hasSimilarTempMessage && isSenderMe) {
                // Replace temp message with real one
                return prev.map(m => 
                  m.id.startsWith('temp-') && m.sender === 'me' && m.text === mappedMessage.text
                    ? { ...mappedMessage, status: 'sent' }
                    : m
                );
              }
              return [...prev, mappedMessage];
            });
            
            // Show new messages indicator if not scrolled to bottom (using ref)
            if (!isScrolledToBottomRef.current && !isSenderMe) {
              setHasNewMessages(true);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentWorkspace, toast, playNotificationSound]);

  // Fetch leads phone numbers when filter is enabled
  useEffect(() => {
    async function fetchLeadsPhoneNumbers() {
      if (!currentWorkspace || !filterByLeads) {
        setLeadsPhoneNumbers(new Set());
        return;
      }
      
      setLoadingLeads(true);
      try {
        const { data, error } = await supabase
          .from('leads')
          .select('phone, mobile_number')
          .eq('workspace_id', currentWorkspace.id);
        
        if (error) throw error;
        
        const phoneSet = new Set<string>();
        data?.forEach(lead => {
          // Normalize phone numbers - remove non-digits
          if (lead.phone) {
            phoneSet.add(lead.phone.replace(/\D/g, ''));
          }
          if (lead.mobile_number) {
            phoneSet.add(lead.mobile_number.replace(/\D/g, ''));
          }
        });
        
        setLeadsPhoneNumbers(phoneSet);
      } catch (error) {
        console.error('Error fetching leads phone numbers:', error);
      } finally {
        setLoadingLeads(false);
      }
    }
    
    fetchLeadsPhoneNumbers();
  }, [currentWorkspace, filterByLeads]);

  useEffect(() => {
    if (currentWorkspace) {
      fetchChats();
    }
  }, [currentWorkspace]);

  // Scroll to bottom when new messages arrive (not on initial load - that's handled in fetchMessages)
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1]?.id : null;
  const prevLastMessageIdRef = useRef<string | null>(null);
  
  useEffect(() => {
    // Only auto-scroll if we're already at bottom and it's a new message
    if (lastMessageId && prevLastMessageIdRef.current && lastMessageId !== prevLastMessageIdRef.current) {
      if (isScrolledToBottom) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
    prevLastMessageIdRef.current = lastMessageId;
  }, [lastMessageId, isScrolledToBottom]);

  // Cleanup file preview URL
  useEffect(() => {
    return () => {
      if (filePreview) {
        URL.revokeObjectURL(filePreview);
      }
    };
  }, [filePreview]);

  const invokeAuthedFunction = useCallback(async (name: string, body: any) => {
    const accessToken = session?.access_token;
    if (!accessToken) {
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    const { data, error } = await supabase.functions.invoke(name, {
      body,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (error) throw error;
    return data;
  }, [session?.access_token]);

  async function fetchChats() {
    setLoadingChats(true);
    try {
      const data = await invokeAuthedFunction('get-chats', { workspaceId: currentWorkspace.id });
      setChats(data.chats || []);
    } catch (error: any) {
      toast({
        title: 'Erro ao carregar conversas',
        description: error.message,
        variant: 'destructive',
      });
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
      const data = await invokeAuthedFunction('get-chat-messages', {
        workspaceId: currentWorkspace?.id,
        chatId,
        limit: 50,
        before: beforeCursor,
      });

      // Messages come from API newest first, but we need oldest first (newest at bottom)
      const newMessages = (data.messages || []).reverse();
      
      if (beforeCursor) {
        // Prepend older messages (they come newest first, so after reverse they're oldest first)
        setMessages(prev => [...newMessages, ...prev]);
      } else {
        setMessages(newMessages);
        // Force scroll to bottom after initial load
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
        }, 100);
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
    // Clear any selected file and search when changing chats
    clearSelectedFile();
    setMessageSearchQuery('');
    setMessageSearchActive(false);
    setCurrentMatchIndex(0);
    
    // Mark chat as read (reset unread count in UI immediately)
    if (chat.unread_count > 0) {
      setChats(prev => prev.map(c => 
        c.id === chat.id ? { ...c, unread_count: 0 } : c
      ));
      
      // Call backend to mark as read (fire and forget)
      invokeAuthedFunction('mark-chat-read', {
        workspaceId: currentWorkspace?.id,
        chatId: chat.id,
        accountId: chat.account_id,
      }).catch(err => {
        console.warn('Failed to mark chat as read:', err);
      });
    }
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

  // Handle voice recording completion
  async function handleVoiceRecordingComplete(audioBlob: Blob) {
    if (!selectedChat || !currentWorkspace) return;
    
    setIsRecordingAudio(false);
    setSending(true);

    // Create optimistic message
    const tempMessage: Message = {
      id: 'temp-' + Date.now(),
      chat_id: selectedChat.id,
      sender: 'me',
      text: '🎤 Mensagem de voz',
      timestamp: new Date().toISOString(),
      status: 'sending',
    };
    setMessages(prev => [...prev, tempMessage]);

    try {
      setUploading(true);
      
      // Create a File from the Blob
      const fileName = `voice-${Date.now()}.ogg`;
      const file = new File([audioBlob], fileName, { type: 'audio/ogg' });
      
      // Upload to Supabase Storage
      const filePath = `${currentWorkspace.id}/${selectedChat.id}/${fileName}`;
      const { error: uploadError } = await supabase.storage
        .from('message-attachments')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Get a signed URL for the file
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from('message-attachments')
        .createSignedUrl(filePath, 3600);

      if (signedUrlError) throw signedUrlError;

      setUploading(false);

      // Send voice message via edge function
      const data = await invokeAuthedFunction('send-message', {
        workspaceId: currentWorkspace.id,
        chatId: selectedChat.id,
        attachmentUrl: signedUrlData.signedUrl,
        attachmentType: 'audio/ogg',
        attachmentName: fileName,
        isVoiceNote: true, // Flag to indicate this is a voice note
      });

      // Update temp message with real ID
      setMessages(prev => prev.map(m => 
        m.id === tempMessage.id 
          ? { ...m, id: data.messageId || m.id, status: 'sent' as const }
          : m
      ));
    } catch (error: any) {
      // Remove temp message on error
      setMessages(prev => prev.filter(m => m.id !== tempMessage.id));
      toast({
        title: 'Erro ao enviar áudio',
        description: error.message,
        variant: 'destructive',
      });
      setUploading(false);
    } finally {
      setSending(false);
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
      status: 'sending',
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

      const data = await invokeAuthedFunction('send-message', {
        workspaceId: currentWorkspace?.id,
        chatId: selectedChat.id,
        text: messageText || undefined,
        attachmentUrl,
        attachmentType,
        attachmentName,
      });

      // Replace temp message with real one (mark as sent)
      setMessages(prev => prev.map(m => 
        m.id === tempMessage.id 
          ? { ...m, id: data.messageId || m.id, status: 'sent' as const }
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

  // Filter chats by search and optionally by leads
  const filteredChats = useMemo(() => {
    let filtered = chats.filter(chat => 
      (chat.attendee_name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (chat.attendee_email?.toLowerCase() || '').includes(searchQuery.toLowerCase())
    );
    
    // Apply leads filter if enabled
    if (filterByLeads && leadsPhoneNumbers.size > 0) {
      filtered = filtered.filter(chat => {
        // Extract phone from attendee_identifier (usually the phone number)
        const chatPhone = chat.attendee_identifier?.replace(/\D/g, '') || '';
        // Check if any part of the phone number matches leads
        return Array.from(leadsPhoneNumbers).some(leadPhone => 
          chatPhone.includes(leadPhone) || leadPhone.includes(chatPhone)
        );
      });
    } else if (filterByLeads && leadsPhoneNumbers.size === 0 && !loadingLeads) {
      // If filter is on but no leads have phone numbers, show empty
      return [];
    }
    
    return filtered;
  }, [chats, searchQuery, filterByLeads, leadsPhoneNumbers, loadingLeads]);

  const FileIcon = selectedFile ? getFileIcon(selectedFile.type) : FileText;

  return (
    <AppLayout>
      <div className="h-full flex flex-col">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1 min-h-0">
          {/* Chat List */}
          <Card className="md:col-span-1 flex flex-col min-h-0 overflow-hidden">
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
          <Card className="md:col-span-2 flex flex-col min-h-0 overflow-hidden">
            {selectedChat ? (
              <>
                <CardHeader className="pb-3 border-b space-y-3">
                  <div className="flex items-center justify-between">
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
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setMessageSearchActive(!messageSearchActive)}
                      className={cn(messageSearchActive && "bg-muted")}
                    >
                      <Search className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  {/* Message Search Bar */}
                  {messageSearchActive && (
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Buscar nas mensagens..."
                          className="pl-9 pr-20"
                          value={messageSearchQuery}
                          onChange={(e) => {
                            setMessageSearchQuery(e.target.value);
                            setCurrentMatchIndex(0);
                          }}
                          autoFocus
                        />
                        {messageSearchQuery && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                            {matchingMessages.length > 0 
                              ? `${currentMatchIndex + 1}/${matchingMessages.length}`
                              : '0/0'
                            }
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={goToPrevMatch}
                          disabled={matchingMessages.length === 0}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={goToNextMatch}
                          disabled={matchingMessages.length === 0}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setMessageSearchActive(false);
                            setMessageSearchQuery('');
                            setCurrentMatchIndex(0);
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden p-0 relative">
                  <ScrollArea 
                    className="h-full p-4" 
                    ref={scrollAreaRef}
                    onScrollCapture={handleScroll}
                  >
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
                        
                        {messages.map((msg) => {
                          const isMatch = matchingMessages.includes(msg.id);
                          const isCurrentMatch = matchingMessages[currentMatchIndex] === msg.id;
                          
                          return (
                            <div
                              key={msg.id}
                              ref={(el) => {
                                if (el) messageRefs.current.set(msg.id, el);
                                else messageRefs.current.delete(msg.id);
                              }}
                              className={cn(
                                'flex transition-all duration-300',
                                msg.sender === 'me' ? 'justify-end' : 'justify-start',
                                isCurrentMatch && 'scale-[1.02]'
                              )}
                            >
                              <div
                                className={cn(
                                  'max-w-[70%] rounded-lg px-4 py-2 transition-all',
                                  msg.sender === 'me'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted',
                                  isCurrentMatch && 'ring-2 ring-accent ring-offset-2 ring-offset-background'
                                )}
                              >
                                {/* Attachments (audio, images, video, files) */}
                                {msg.attachments && msg.attachments.length > 0 && currentWorkspace && (
                                  <MessageAttachments 
                                    attachments={msg.attachments} 
                                    messageId={msg.id}
                                    workspaceId={currentWorkspace.id}
                                    variant={msg.sender === 'me' ? 'sent' : 'received'}
                                  />
                                )}
                                
                                {/* Text content */}
                                {msg.text && (
                                  <p className={cn(
                                    'text-sm whitespace-pre-wrap',
                                    msg.attachments?.length && 'mt-2'
                                  )}>
                                    {messageSearchQuery && isMatch 
                                      ? highlightText(msg.text, messageSearchQuery)
                                      : msg.text
                                    }
                                  </p>
                                )}
                                
                                {/* Empty message with no text and no attachments */}
                                {!msg.text && (!msg.attachments || msg.attachments.length === 0) && (
                                  <p className="text-sm text-muted-foreground italic">
                                    Mensagem vazia
                                  </p>
                                )}
                                
                                <div className={cn(
                                  'flex items-center gap-1 text-xs mt-1',
                                  msg.sender === 'me' ? 'text-primary-foreground/70 justify-end' : 'text-muted-foreground'
                                )}>
                                  <span>
                                    {msg.timestamp && !isNaN(new Date(msg.timestamp).getTime())
                                      ? format(new Date(msg.timestamp), 'HH:mm', { locale: ptBR })
                                      : '—'}
                                  </span>
                                  {msg.sender === 'me' && <MessageStatus status={msg.status} />}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        <div ref={messagesEndRef} />
                      </div>
                    )}
                  </ScrollArea>
                  
                  {/* New messages indicator */}
                  {hasNewMessages && (
                    <Button
                      onClick={scrollToBottom}
                      className="absolute bottom-4 left-1/2 -translate-x-1/2 shadow-lg animate-fade-in"
                      size="sm"
                    >
                      <ChevronDown className="h-4 w-4 mr-2" />
                      Novas mensagens
                    </Button>
                  )}
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
                    <VoiceRecorder 
                      onRecordingComplete={handleVoiceRecordingComplete}
                      disabled={sending || uploading}
                    />
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
