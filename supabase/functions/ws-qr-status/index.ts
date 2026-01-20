import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Check for WebSocket upgrade
  const upgradeHeader = req.headers.get('Upgrade');
  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    return new Response(JSON.stringify({ error: 'Expected WebSocket connection' }), { 
      status: 426, 
      headers: corsHeaders 
    });
  }

  try {
    // Get session_id and token from query params
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('session_id');
    const token = url.searchParams.get('token');
    const workspaceId = url.searchParams.get('workspace_id');

    if (!sessionId || !token || !workspaceId) {
      return new Response(JSON.stringify({ error: 'session_id, token, and workspace_id are required' }), { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    // Validate token
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: corsHeaders 
      });
    }

    // Verify workspace membership
    const { data: member } = await supabase
      .from('workspace_members')
      .select('id, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userData.user.id)
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: 'Not a member of this workspace' }), { 
        status: 403, 
        headers: corsHeaders 
      });
    }

    // Upgrade to WebSocket
    const { socket, response } = Deno.upgradeWebSocket(req);

    const PROVIDER_DSN = Deno.env.get('UNIPILE_DSN');
    const PROVIDER_API_KEY = Deno.env.get('UNIPILE_API_KEY');

    let pollInterval: number | undefined;
    let connectionTimeout: number | undefined;

    socket.onopen = () => {
      console.log(`WebSocket opened for session: ${sessionId}`);
      
      // Send initial pending status
      socket.send(JSON.stringify({ 
        status: 'pending',
        message: 'Aguardando leitura do QR Code...'
      }));

      // Set connection timeout (10 minutes)
      connectionTimeout = setTimeout(() => {
        console.log(`Session ${sessionId} timed out`);
        socket.send(JSON.stringify({ 
          status: 'failed', 
          error: 'Sessão expirada. Por favor, tente novamente.' 
        }));
        socket.close();
      }, 10 * 60 * 1000);

      // Poll provider for status updates
      if (PROVIDER_DSN && PROVIDER_API_KEY) {
        pollInterval = setInterval(async () => {
          try {
            // Check account status from provider
            const response = await fetch(`https://${PROVIDER_DSN}/api/v1/accounts`, {
              method: 'GET',
              headers: {
                'X-API-KEY': PROVIDER_API_KEY,
                'accept': 'application/json',
              },
            });

            if (response.ok) {
              const data = await response.json();
              const accounts = data.items || data || [];
              
              // Check if any account was recently connected
              const recentAccount = accounts.find((acc: any) => {
                const createdAt = new Date(acc.created_at || acc.createdAt || 0);
                const now = new Date();
                const diffMs = now.getTime() - createdAt.getTime();
                // Consider accounts created in the last 2 minutes
                return diffMs < 2 * 60 * 1000 && 
                       (acc.status === 'OK' || acc.status === 'CONNECTED');
              });

              if (recentAccount) {
                console.log(`Account connected: ${recentAccount.id}`);
                
                // Determine channel
                let channel = 'whatsapp';
                if (recentAccount.type) {
                  channel = recentAccount.type.toLowerCase();
                } else if (recentAccount.sources?.length) {
                  const sourceTypes = recentAccount.sources.map((s: any) => s.type?.toLowerCase());
                  if (sourceTypes.includes('whatsapp')) channel = 'whatsapp';
                }

                socket.send(JSON.stringify({ 
                  status: 'connected', 
                  account_id: recentAccount.id,
                  channel,
                  name: recentAccount.name || `Account ${recentAccount.id.slice(0, 8)}`,
                }));
                
                clearInterval(pollInterval);
                clearTimeout(connectionTimeout);
                socket.close();
              }
            }
          } catch (error) {
            console.error('Poll error:', error);
          }
        }, 3000); // Poll every 3 seconds
      }
    };

    socket.onclose = () => {
      console.log(`WebSocket closed for session: ${sessionId}`);
      if (pollInterval) clearInterval(pollInterval);
      if (connectionTimeout) clearTimeout(connectionTimeout);
    };

    socket.onerror = (error) => {
      console.error(`WebSocket error for session ${sessionId}:`, error);
      if (pollInterval) clearInterval(pollInterval);
      if (connectionTimeout) clearTimeout(connectionTimeout);
    };

    socket.onmessage = (event) => {
      console.log(`Received message for session ${sessionId}:`, event.data);
      // Handle any client messages if needed
    };

    return response;

  } catch (err) {
    const error = err as Error;
    console.error('Error in ws-qr-status:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
