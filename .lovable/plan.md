

# Implementação: Fallback Bulletproof para Convites Aceitos

## Contexto

O arquivo `webhook-unipile-events/index.ts` atualmente só faz match por `provider_message_id`. Eventos de convite aceito (`relation.new`, `connection.new`) frequentemente chegam sem `message_id`, apenas com `provider_id`, causando falha no tracking de `accepted_at`.

## Análise do Código Atual

| Linha | Conteúdo | Observação |
|-------|----------|------------|
| 23-52 | `MESSAGE_STATUS_MAP` | Já inclui eventos de convite |
| 138-142 | Extração `providerId` | Limitada - precisa expandir |
| 218-286 | Match por `messageId` | Funciona, não alterar |
| 287-290 | Response | Inserir fallback ANTES |

## Alterações Planejadas

### 1. Adicionar constante INVITE_EVENT_TYPES (após linha 52)

```typescript
const INVITE_EVENT_TYPES = [
  'relation.new',
  'connection.new', 
  'connection.accepted',
  'invitation.accepted',
];
```

### 2. Expandir extração de providerId (linhas 138-142)

**De:**
```typescript
const providerId = 
  eventData.provider_id ||
  eventData.user_id ||
  eventData.attendee_id ||
  eventData.recipient_id;
```

**Para:**
```typescript
const providerId = 
  eventData.provider_id ||
  eventData.user_id ||
  eventData.attendee_id ||
  eventData.recipient_id ||
  eventData.profile_id ||
  eventData.member_id ||
  eventData.sender_id ||
  payload.provider_id ||
  payload.user_id;
```

### 3. Inserir bloco de fallback (após linha 286, antes da linha 288)

O fallback implementa:

1. **Lead lookup seguro**: `.limit(5)` + warning se múltiplos
2. **pendingCount com filtro invite**: join `campaigns!inner(linkedin_action)` + `.eq('campaigns.linkedin_action', 'invite')`
3. **Busca inviteLead**: mesmo filtro, sem alias, `maybeSingle()`
4. **Update idempotente**: `.is('accepted_at', null).select('id')` para obter rows atualizadas
5. **Sempre marcar matched**: mesmo se accepted_at já existia
6. **Sempre inserir campaign_event**: com `metadata.match_method` e `metadata.provider_id`

```typescript
// ============================================
// FALLBACK: MATCH BY PROVIDER_ID FOR INVITES
// ============================================
const isInviteEvent = INVITE_EVENT_TYPES.includes(eventType);

if (!matchedLeadId && isInviteEvent && providerId) {
  console.log(`[${correlationId}] Fallback invite match: provider_id=${providerId}`);
  
  // 1) Lead lookup (safe on duplicates)
  let leadQuery = serviceClient
    .from('leads')
    .select('id, workspace_id')
    .eq('linkedin_provider_id', providerId);
  
  if (workspaceId) leadQuery = leadQuery.eq('workspace_id', workspaceId);
  
  const { data: leadResults, error: leadError } = await leadQuery.limit(5);
  
  if (leadError) console.error(`[${correlationId}] lead lookup error`, leadError);
  
  if (leadResults && leadResults.length > 0) {
    if (leadResults.length > 1) {
      console.warn(`[${correlationId}] WARNING: ${leadResults.length} leads found for provider_id=${providerId}. Using first.`);
    }
    
    const leadData = leadResults[0];
    
    // 2) pendingCount ONLY for invite campaigns
    const { count: pendingCount, error: pendingErr } = await serviceClient
      .from('campaign_leads')
      .select('id, campaigns!inner(linkedin_action)', { count: 'exact', head: true })
      .eq('lead_id', leadData.id)
      .eq('status', 'sent')
      .is('accepted_at', null)
      .eq('campaigns.linkedin_action', 'invite');
    
    if (pendingErr) console.error(`[${correlationId}] pendingCount error`, pendingErr);
    
    if (pendingCount && pendingCount > 1) {
      console.warn(`[${correlationId}] WARNING: ${pendingCount} pending INVITE campaign_leads for lead=${leadData.id}. Using most recent.`);
    }
    
    // 3) Find most recent invite campaign_lead
    const { data: inviteLead, error: inviteError } = await serviceClient
      .from('campaign_leads')
      .select(`
        id,
        campaign_id,
        lead_id,
        status,
        provider_message_id,
        campaigns!inner(linkedin_action)
      `)
      .eq('lead_id', leadData.id)
      .eq('status', 'sent')
      .is('accepted_at', null)
      .eq('campaigns.linkedin_action', 'invite')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (inviteError) {
      console.error(`[${correlationId}] inviteLead lookup error`, inviteError);
    } else if (inviteLead) {
      matchedLeadId = inviteLead.id;
      const timestamp = new Date().toISOString();
      
      // 4) Idempotent accepted_at update
      const { data: updatedRows, error: updateError } = await serviceClient
        .from('campaign_leads')
        .update({ accepted_at: timestamp })
        .eq('id', matchedLeadId)
        .is('accepted_at', null)
        .select('id');
      
      if (updateError) {
        console.error(`[${correlationId}] accepted_at update error`, updateError);
      }
      
      const updated = (updatedRows?.length ?? 0);
      if (updated === 0) {
        console.log(`[${correlationId}] Idempotent skip: campaign_lead=${matchedLeadId} already had accepted_at`);
      } else {
        console.log(`[${correlationId}] accepted_at set for campaign_lead=${matchedLeadId}`);
      }
      
      // 5) ALWAYS mark event as matched
      await serviceClient
        .from('unipile_events')
        .update({
          campaign_lead_id: matchedLeadId,
          lead_id: leadData.id,
          workspace_id: leadData.workspace_id,
          matched: true,
          processed_at: timestamp,
        })
        .eq('event_id', eventId);
      
      // 6) ALWAYS insert campaign_event
      await serviceClient
        .from('campaign_events')
        .insert({
          campaign_id: inviteLead.campaign_id,
          campaign_lead_id: matchedLeadId,
          event_type: eventType,
          provider_message_id: inviteLead.provider_message_id || null,
          metadata: {
            correlation_id: correlationId,
            unipile_event_id: eventId,
            match_method: 'fallback_provider_id',
            provider_id: providerId,
          },
        });
    } else {
      console.log(`[${correlationId}] No pending INVITE campaign_lead found for lead=${leadData.id}`);
    }
  } else {
    console.log(`[${correlationId}] No lead found for provider_id=${providerId}${workspaceId ? ` workspace=${workspaceId}` : ''}`);
  }
}
```

## Fluxo de Decisão

```text
Webhook recebe evento
        │
        ▼
┌───────────────────┐
│ Tem messageId?    │
│ SIM → Match por   │───► Atualiza timestamps
│       message_id  │     (DM/InMail funcionam)
│ NÃO → Continua    │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ É evento invite?  │
│ NÃO → Fim         │
│ SIM → Continua    │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Tem providerId?   │
│ NÃO → Log warning │
│ SIM → Continua    │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Busca lead por    │
│ provider_id +     │
│ workspace scope   │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Busca invite      │
│ campaign_lead     │
│ pendente          │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Update idempotente│
│ accepted_at       │
│ (só se null)      │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ SEMPRE:           │
│ - matched = true  │
│ - campaign_event  │
└───────────────────┘
```

## Checklist de Requisitos

| # | Requisito | Implementação |
|---|-----------|---------------|
| 1 | Join sem alias | `campaigns!inner(linkedin_action)` + `.eq('campaigns.linkedin_action', 'invite')` |
| 2 | pendingCount só invites | Mesmo join/filtro aplicado |
| 3 | Update idempotente | `.is('accepted_at', null)` |
| 4 | Lead lookup safe | `.limit(5)` + warning se >1 |
| 5 | Não usar updateCount | `.select('id')` + `updatedRows?.length` |
| 6 | Sempre marcar matched | Executa mesmo se update=0 |

## Queries de Validação

**Eventos não matchados:**
```sql
SELECT id, created_at, event_type, matched 
FROM unipile_events
WHERE matched = false 
  AND event_type IN ('relation.new', 'connection.new', 'connection.accepted', 'invitation.accepted')
ORDER BY created_at DESC 
LIMIT 20;
```

**Convites aceitos:**
```sql
SELECT cl.id, cl.accepted_at, c.linkedin_action
FROM campaign_leads cl 
JOIN campaigns c ON c.id = cl.campaign_id
WHERE c.linkedin_action = 'invite' AND cl.accepted_at IS NOT NULL
ORDER BY cl.accepted_at DESC 
LIMIT 20;
```

**Eventos com fallback:**
```sql
SELECT id, event_type, metadata->>'match_method', metadata->>'provider_id'
FROM campaign_events
WHERE metadata->>'match_method' = 'fallback_provider_id'
ORDER BY created_at DESC 
LIMIT 20;
```

## Definition of Done

- DM/InMail continuam funcionando via messageId (não afetados)
- `relation.new`/`connection.*` sem message_id mas com provider_id:
  - `campaign_leads.accepted_at` preenchido (ou skip idempotente)
  - `unipile_events.matched = true` com `campaign_lead_id`
  - `campaign_events` com `metadata.match_method = 'fallback_provider_id'`
- Sem exceptions com leads duplicados
- Logs claros indicando método de match usado

