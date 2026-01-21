-- Enable replica identity for chats table to receive DELETE events with old data
ALTER TABLE public.chats REPLICA IDENTITY FULL;

-- Enable replica identity for messages table to receive DELETE events with old data  
ALTER TABLE public.messages REPLICA IDENTITY FULL;