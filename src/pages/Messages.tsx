import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { useAccounts } from '@/hooks/useAccounts';
import { supabase } from '@/integrations/supabase/client';
import { MessageAttachments } from '@/components/messages/MessageAttachments';
import { VoiceRecorder } from '@/components/messages/VoiceRecorder';
import { StartConversationDialog } from '@/components/messages/StartConversationDialog';
import { ChatLastMessagePreview } from '@/components/messages/ChatLastMessagePreview';
import { Lead, Chat, Message } from '@/types';
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
  Plus,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

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
  const { accounts } = useAccounts('whatsapp');
  const [searchParams, setSearchParams] = useSearchParams();
  
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
  
  // Start new conversation dialog
  const [startConversationOpen, setStartConversationOpen] = useState(false);
  const [startingNewConversation, setStartingNewConversation] = useState(false);

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

  // Subscribe to chats table updates for real-time chat list refresh
  useEffect(() => {
    if (!currentWorkspace) return;

    const chatsChannel = supabase.channel(`chats:${currentWorkspace.id}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'chats',
          filter: `workspace_id=eq.${currentWorkspace.id}`,
        },
        (payload) => {
          console.log('Realtime chat update:', payload.eventType);
          
          if (payload.eventType === 'INSERT') {
            const newChat = payload.new as any;
            // Add new chat to the list
            const mappedChat: Chat = {
              id: newChat.external_id,
              account_id: newChat.account_id,
              attendee_identifier: newChat.attendee_identifier,
              attendee_name: newChat.attendee_name || `+${newChat.attendee_identifier}`,
              attendee_picture: newChat.attendee_picture,
              last_message: newChat.last_message || '',
              last_message_type: newChat.last_message_type,
              last_message_duration: newChat.last_message_duration,
              last_message_at: newChat.last_message_at,
              unread_count: newChat.unread_count || 0,
            };
            
            setChats(prev => {
              // Avoid duplicates
              if (prev.some(c => c.id === mappedChat.id)) return prev;
              // Add to beginning (most recent)
              return [mappedChat, ...prev];
            });
          } else if (payload.eventType === 'UPDATE') {
            const updatedChat = payload.new as any;
            setChats(prev => prev.map(c => 
              c.id === updatedChat.external_id
                ? {
                    ...c,
                    attendee_name: updatedChat.attendee_name || c.attendee_name,
                    attendee_picture: updatedChat.attendee_picture ?? c.attendee_picture,
                    last_message: updatedChat.last_message || c.last_message,
                    last_message_type: updatedChat.last_message_type,
                    last_message_duration: updatedChat.last_message_duration,
                    last_message_at: updatedChat.last_message_at || c.last_message_at,
                    unread_count: updatedChat.unread_count ?? c.unread_count,
                  }
                : c
            ));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(chatsChannel);
    };
  }, [currentWorkspace]);

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

  // Handle URL params for starting conversation from lead details
  useEffect(() => {
    const phoneNumber = searchParams.get('startConversation');
    const leadName = searchParams.get('leadName');
    
    if (phoneNumber && currentWorkspace && accounts.length > 0) {
      // Clear params immediately
      setSearchParams({});
      
      // Start conversation with this phone number
      handleStartConversationWithPhone(phoneNumber, leadName || undefined);
    }
  }, [searchParams, currentWorkspace, accounts]);

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
      // ============================================
      // HYBRID LOADING: Load from cache first, then sync in background
      // ============================================
      
      // Step 1: Load cached chats from local database (instant)
      const { data: cachedChats, error: cacheError } = await supabase
        .from('chats')
        .select('*')
        .eq('workspace_id', currentWorkspace.id)
        .order('last_message_at', { ascending: false });
      
      if (cacheError) {
        console.warn('Error loading cached chats:', cacheError);
      }
      
      // Fetch leads to match phone numbers with names
      const { data: leads } = await supabase
        .from('leads')
        .select('full_name, mobile_number, phone')
        .eq('workspace_id', currentWorkspace.id);
      
      // Create a map of phone numbers to lead names
      const phoneToName = new Map<string, string>();
      if (leads && leads.length > 0) {
        leads.forEach(lead => {
          const phone = lead.mobile_number || lead.phone;
          if (phone && lead.full_name) {
            const normalizedPhone = phone.replace(/\D/g, '');
            phoneToName.set(normalizedPhone, lead.full_name);
          }
        });
      }
      
      // Map cached chats to Chat interface
      const mapCachedToChat = (cached: any): Chat => {
        const chatPhone = cached.attendee_identifier?.replace(/\D/g, '') || '';
        let attendeeName = cached.attendee_name;
        
        // Update name from leads if current name looks like a phone number
        if (attendeeName?.startsWith('+') || !attendeeName) {
          for (const [leadPhone, leadName] of phoneToName) {
            if (chatPhone.includes(leadPhone) || leadPhone.includes(chatPhone)) {
              attendeeName = leadName;
              break;
            }
          }
        }
        
        return {
          id: cached.external_id,
          account_id: cached.account_id,
          attendee_identifier: cached.attendee_identifier,
          attendee_name: attendeeName || `+${chatPhone}`,
          attendee_email: undefined,
          attendee_picture: cached.attendee_picture,
          last_message: cached.last_message || '',
          last_message_type: cached.last_message_type,
          last_message_duration: cached.last_message_duration,
          last_message_at: cached.last_message_at,
          unread_count: cached.unread_count || 0,
        };
      };
      
      // ============================================
      // DEDUPLICATION: Remove duplicate chats by attendee_identifier
      // Keep the most recent chat for each phone number
      // ============================================
      const deduplicateChats = (chats: Chat[]): Chat[] => {
        const chatMap = new Map<string, Chat>();
        
        for (const chat of chats) {
          // Use attendee_identifier as key, fallback to id
          const key = chat.attendee_identifier || chat.id;
          const existing = chatMap.get(key);
          
          if (!existing) {
            chatMap.set(key, chat);
          } else {
            // Keep the one with the most recent message
            const existingDate = new Date(existing.last_message_at || 0).getTime();
            const currentDate = new Date(chat.last_message_at || 0).getTime();
            
            if (currentDate > existingDate) {
              // Sum unread counts when deduplicating
              chat.unread_count = (chat.unread_count || 0) + (existing.unread_count || 0);
              chatMap.set(key, chat);
            } else {
              existing.unread_count = (existing.unread_count || 0) + (chat.unread_count || 0);
            }
          }
        }
        
        // Sort by last_message_at descending
        return Array.from(chatMap.values()).sort((a, b) => 
          new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
        );
      };

      // If we have cached chats, show them immediately
      if (cachedChats && cachedChats.length > 0) {
        const mappedCachedChats = cachedChats.map(mapCachedToChat);
        const deduplicatedChats = deduplicateChats(mappedCachedChats);
        console.log(`Loaded ${cachedChats.length} chats, deduplicated to ${deduplicatedChats.length}`);
        setChats(deduplicatedChats);
        setLoadingChats(false);
        
        // Step 2: Sync with provider in background
        invokeAuthedFunction('sync-chats', { workspaceId: currentWorkspace.id })
          .then(() => {
            console.log('Background sync completed');
            // Refresh from cache after sync
            return supabase
              .from('chats')
              .select('*')
              .eq('workspace_id', currentWorkspace.id)
              .order('last_message_at', { ascending: false });
          })
          .then(({ data: refreshedChats }) => {
            if (refreshedChats && refreshedChats.length > 0) {
              const mappedRefreshed = refreshedChats.map(mapCachedToChat);
              const deduplicatedRefreshed = deduplicateChats(mappedRefreshed);
              setChats(deduplicatedRefreshed);
            }
          })
          .catch(err => console.warn('Background sync failed:', err));
        
        return;
      }
      
      // Step 3: No cache - fall back to direct API call (first load)
      console.log('No cached chats, fetching from provider...');
      const data = await invokeAuthedFunction('get-chats', { workspaceId: currentWorkspace.id });
      const fetchedChats: Chat[] = data.chats || [];
      
      // Update chats with lead names where phone matches
      if (phoneToName.size > 0) {
        fetchedChats.forEach(chat => {
          const chatPhone = chat.attendee_identifier?.replace(/\D/g, '') || '';
          if (chat.attendee_name?.startsWith('+') || !chat.attendee_name) {
            for (const [leadPhone, leadName] of phoneToName) {
              if (chatPhone.includes(leadPhone) || leadPhone.includes(chatPhone)) {
                chat.attendee_name = leadName;
                break;
              }
            }
          }
        });
      }
      
      setChats(fetchedChats);
      
      // Trigger background sync to populate cache for next time
      invokeAuthedFunction('sync-chats', { workspaceId: currentWorkspace.id })
        .catch(err => console.warn('Initial sync failed:', err));
        
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
      // ============================================
      // HYBRID LOADING: Load from cache first for initial load
      // ============================================
      if (!beforeCursor) {
        // Step 1: Load cached messages from local database (instant)
        const { data: cachedMessages, error: cacheError } = await supabase
          .from('messages')
          .select('*')
          .eq('workspace_id', currentWorkspace?.id)
          .eq('chat_id', chatId)
          .order('timestamp', { ascending: true })
          .limit(50);
        
        if (!cacheError && cachedMessages && cachedMessages.length > 0) {
          console.log(`Loaded ${cachedMessages.length} messages from cache for chat ${chatId}`);
          
          // Map cached messages to Message interface
          const mappedCached: Message[] = cachedMessages.map((msg: any) => {
            let attachments: Message['attachments'] = undefined;
            if (msg.attachments) {
              try {
                const parsed = typeof msg.attachments === 'string' 
                  ? JSON.parse(msg.attachments) 
                  : msg.attachments;
                if (Array.isArray(parsed) && parsed.length > 0) {
                  attachments = parsed;
                }
              } catch (e) {
                console.warn('Failed to parse attachments:', e);
              }
            }
            
            return {
              id: msg.external_id || msg.id,
              chat_id: msg.chat_id,
              sender: msg.sender as 'me' | 'them',
              text: msg.text || '',
              timestamp: msg.timestamp,
              status: msg.sender === 'me' ? 'sent' : undefined,
              attachments,
            };
          });
          
          setMessages(mappedCached);
          setLoadingMessages(false);
          
          // Force scroll to bottom
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
          }, 100);
          
          // Step 2: Fetch newer messages from API in background
          invokeAuthedFunction('get-chat-messages', {
            workspaceId: currentWorkspace?.id,
            chatId,
            limit: 50,
          }).then((data) => {
            const apiMessages = (data.messages || []).reverse();
            if (apiMessages.length > 0) {
              // Merge with existing, avoiding duplicates
              setMessages(prev => {
                const existingIds = new Set(prev.map(m => m.id));
                const newMsgs = apiMessages.filter((m: Message) => !existingIds.has(m.id));
                if (newMsgs.length > 0) {
                  console.log(`Added ${newMsgs.length} new messages from API`);
                  return [...prev, ...newMsgs];
                }
                return prev;
              });
            }
            setCursor(data.cursor || null);
            setHasMore(!!data.cursor && apiMessages.length > 0);
          }).catch(err => console.warn('Background message fetch failed:', err));
          
          return;
        }
      }

      // Step 3: No cache or loading older - fetch from API
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
      // Check if this is a new conversation (temporary chat)
      const isNewConversation = selectedChat.id.startsWith('new-');
      
      let data;
      if (isNewConversation) {
        // For new conversations, use accountId + attendeesIds
        const phoneNumber = selectedChat.attendee_identifier;
        
        data = await invokeAuthedFunction('send-message', {
          workspaceId: currentWorkspace.id,
          accountId: selectedChat.account_id,
          attendeesIds: [phoneNumber],
          attachmentUrl: signedUrlData.signedUrl,
          attachmentType: 'audio/ogg',
          attachmentName: fileName,
          isVoiceNote: true,
        });
        
        // Update the chat with the real chat ID from the response
        if (data.chatId) {
          const realChatId = data.chatId;
          setChats(prev => prev.map(c => 
            c.id === selectedChat.id 
              ? { ...c, id: realChatId }
              : c
          ));
          setSelectedChat(prev => prev ? { ...prev, id: realChatId } : null);
        }
      } else {
        data = await invokeAuthedFunction('send-message', {
          workspaceId: currentWorkspace.id,
          chatId: selectedChat.id,
          attachmentUrl: signedUrlData.signedUrl,
          attachmentType: 'audio/ogg',
          attachmentName: fileName,
          isVoiceNote: true,
        });
      }

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

      // Check if this is a new conversation (temporary chat)
      const isNewConversation = selectedChat.id.startsWith('new-');
      
      let data;
      if (isNewConversation) {
        // For new conversations, use accountId + attendeesIds
        // The attendee_identifier contains the phone number
        const phoneNumber = selectedChat.attendee_identifier;
        
        data = await invokeAuthedFunction('send-message', {
          workspaceId: currentWorkspace?.id,
          accountId: selectedChat.account_id,
          attendeesIds: [phoneNumber],
          text: messageText || undefined,
          attachmentUrl,
          attachmentType,
          attachmentName,
        });
        
        // Update the chat with the real chat ID from the response
        if (data.chatId) {
          const realChatId = data.chatId;
          setChats(prev => prev.map(c => 
            c.id === selectedChat.id 
              ? { ...c, id: realChatId }
              : c
          ));
          setSelectedChat(prev => prev ? { ...prev, id: realChatId } : null);
        }
      } else {
        // For existing chats, use chatId
        data = await invokeAuthedFunction('send-message', {
          workspaceId: currentWorkspace?.id,
          chatId: selectedChat.id,
          text: messageText || undefined,
          attachmentUrl,
          attachmentType,
          attachmentName,
        });
      }

      // Replace temp message with real one (mark as sent)
      setMessages(prev => prev.map(m => 
        m.id === tempMessage.id 
          ? { ...m, id: data.messageId || m.id, status: 'sent' as const }
          : m
      ));

      // ============================================
      // PERSIST SENT MESSAGE: Cache locally so it survives page reload
      // This ensures message appears even if webhook fails
      // ============================================
      if (data.messageId && currentWorkspace) {
        const realChatId = isNewConversation && data.chatId ? data.chatId : selectedChat.id;
        const messageToCache = {
          workspace_id: currentWorkspace.id,
          account_id: selectedChat.account_id,
          chat_id: realChatId,
          external_id: data.messageId,
          sender: 'me',
          text: messageText || null,
          attachments: attachmentUrl ? [{
            type: attachmentType?.split('/')[0] || 'file',
            url: attachmentUrl,
            mime_type: attachmentType,
            filename: attachmentName,
          }] : null,
          timestamp: new Date().toISOString(),
        };
        
        // Fire-and-forget - don't block UI
        supabase.from('messages')
          .upsert(messageToCache, { onConflict: 'workspace_id,external_id', ignoreDuplicates: true })
          .then(({ error }) => {
            if (error) console.warn('Failed to cache sent message:', error);
            else console.log('Sent message cached locally');
          });
      }
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

  // Start a new conversation with a lead (from dialog or URL param)
  async function handleStartConversationWithPhone(phoneNumber: string, leadName?: string) {
    if (!currentWorkspace || accounts.length === 0) {
      toast({
        title: 'Conta WhatsApp não conectada',
        description: 'Conecte uma conta WhatsApp nas configurações para iniciar conversas.',
        variant: 'destructive',
      });
      return;
    }

    setStartingNewConversation(true);
    
    try {
      // Normalize phone number (remove non-digits, ensure has country code)
      let normalizedPhone = phoneNumber.replace(/\D/g, '');
      
      // Check if there's already a chat with this phone number
      const existingChat = chats.find(chat => {
        const chatPhone = chat.attendee_identifier?.replace(/\D/g, '') || '';
        return chatPhone.includes(normalizedPhone) || normalizedPhone.includes(chatPhone);
      });

      if (existingChat) {
        // Select existing chat
        handleSelectChat(existingChat);
        toast({
          title: 'Conversa existente',
          description: `Abrindo conversa com ${existingChat.attendee_name || leadName || normalizedPhone}`,
        });
      } else {
        // Create a new chat entry (it will be confirmed when first message is sent)
        const whatsappAccount = accounts[0];
        
        // Create a temporary chat for the new conversation
        const tempChat: Chat = {
          id: `new-${normalizedPhone}`,
          account_id: whatsappAccount.account_id,
          attendee_identifier: normalizedPhone,
          attendee_name: leadName || `+${normalizedPhone}`,
          attendee_picture: null,
          attendee_email: undefined,
          last_message: '',
          last_message_at: new Date().toISOString(),
          unread_count: 0,
        };
        
        // Add to chat list and select it
        setChats(prev => [tempChat, ...prev]);
        setSelectedChat(tempChat);
        setMessages([]);
        
        toast({
          title: 'Nova conversa',
          description: `Iniciando conversa com ${leadName || `+${normalizedPhone}`}. Envie uma mensagem para começar.`,
        });
      }
    } catch (error: any) {
      toast({
        title: 'Erro ao iniciar conversa',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setStartingNewConversation(false);
    }
  }

  // Handle selecting a lead from the dialog
  function handleSelectLeadForConversation(lead: Lead) {
    const phoneNumber = lead.mobile_number || lead.phone;
    if (!phoneNumber) {
      toast({
        title: 'Lead sem telefone',
        description: 'Este lead não possui número de telefone cadastrado.',
        variant: 'destructive',
      });
      return;
    }
    
    handleStartConversationWithPhone(phoneNumber, lead.full_name || undefined);
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
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Conversas</CardTitle>
                <Button 
                  size="sm" 
                  onClick={() => setStartConversationOpen(true)}
                  disabled={startingNewConversation || accounts.length === 0}
                >
                  {startingNewConversation ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-1" />
                      Nova
                    </>
                  )}
                </Button>
              </div>
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
                              <ChatLastMessagePreview 
                                chat={chat} 
                                isTyping={!!typingChats[chat.id]} 
                              />
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
                                    externalMessageId={msg.id}
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
      
      {/* Start Conversation Dialog */}
      <StartConversationDialog
        open={startConversationOpen}
        onOpenChange={setStartConversationOpen}
        onSelectLead={handleSelectLeadForConversation}
      />
    </AppLayout>
  );
}
