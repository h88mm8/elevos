import { useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Message, MessageAttachment } from '@/types';

interface PreCacheOptions {
  workspaceId: string;
  messages: Message[];
  enabled?: boolean;
}

// Track already processed URLs to avoid duplicate caching attempts
const cachedUrls = new Set<string>();
const pendingUrls = new Set<string>();

export function useMediaPreCache({ workspaceId, messages, enabled = true }: PreCacheOptions) {
  const isProcessingRef = useRef(false);

  const cacheMedia = useCallback(async (
    attachment: MessageAttachment,
    messageId: string,
    index: number
  ): Promise<string | null> => {
    const cacheKey = `${messageId}-${index}`;
    
    // Skip if already cached or pending
    if (cachedUrls.has(cacheKey) || pendingUrls.has(cacheKey)) {
      return null;
    }

    // Skip if no URL or URL is already from our storage
    if (!attachment.url) return null;
    if (attachment.url.includes('supabase') && attachment.url.includes('message-attachments')) {
      cachedUrls.add(cacheKey);
      return null;
    }

    pendingUrls.add(cacheKey);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;

      const response = await supabase.functions.invoke('cache-media', {
        body: {
          workspaceId,
          mediaUrl: attachment.url,
          messageId: cacheKey,
          mediaType: attachment.type,
          mimeType: attachment.mime_type || getMimeType(attachment),
          attachmentId: attachment.attachment_id,
          externalMessageId: attachment.external_message_id,
        },
      });

      if (response.data?.success) {
        cachedUrls.add(cacheKey);
        return response.data.url;
      }
    } catch (err) {
      console.warn('Pre-cache failed for:', attachment.url, err);
    } finally {
      pendingUrls.delete(cacheKey);
    }

    return null;
  }, [workspaceId]);

  const preCacheAllMedia = useCallback(async () => {
    if (!enabled || isProcessingRef.current || !workspaceId || messages.length === 0) {
      return;
    }

    isProcessingRef.current = true;

    // Collect all media attachments that need caching
    const mediaToCache: { attachment: MessageAttachment; messageId: string; index: number }[] = [];

    for (const message of messages) {
      if (message.attachments && message.attachments.length > 0) {
        message.attachments.forEach((attachment, index) => {
          // Only cache media types (audio, image, video)
          if (['audio', 'image', 'video'].includes(attachment.type)) {
            const cacheKey = `${message.id}-${index}`;
            
            // Skip if already cached
            if (cachedUrls.has(cacheKey)) return;
            
            // Skip if no URL or is from our storage
            if (!attachment.url) return;
            if (attachment.url.includes('supabase') && attachment.url.includes('message-attachments')) {
              cachedUrls.add(cacheKey);
              return;
            }

            mediaToCache.push({ attachment, messageId: message.id, index });
          }
        });
      }
    }

    if (mediaToCache.length === 0) {
      isProcessingRef.current = false;
      return;
    }

    console.log(`[PreCache] Starting background cache for ${mediaToCache.length} media items`);

    // Process in batches of 3 to avoid overwhelming the server
    const batchSize = 3;
    for (let i = 0; i < mediaToCache.length; i += batchSize) {
      const batch = mediaToCache.slice(i, i + batchSize);
      
      await Promise.allSettled(
        batch.map(({ attachment, messageId, index }) =>
          cacheMedia(attachment, messageId, index)
        )
      );

      // Small delay between batches
      if (i + batchSize < mediaToCache.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`[PreCache] Completed caching ${mediaToCache.length} media items`);
    isProcessingRef.current = false;
  }, [enabled, workspaceId, messages, cacheMedia]);

  // Trigger pre-caching when messages change
  useEffect(() => {
    if (enabled && messages.length > 0) {
      // Delay slightly to prioritize UI rendering
      const timer = setTimeout(() => {
        preCacheAllMedia();
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [enabled, messages, preCacheAllMedia]);

  return {
    preCacheAllMedia,
    cacheMedia,
  };
}

function getMimeType(attachment: MessageAttachment): string {
  switch (attachment.type) {
    case 'audio':
      return 'audio/ogg';
    case 'image':
      return 'image/jpeg';
    case 'video':
      return 'video/mp4';
    default:
      return 'application/octet-stream';
  }
}
