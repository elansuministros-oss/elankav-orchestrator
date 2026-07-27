# ECS-001 — Sistema Autónomo de Seguimiento Comercial

## Decisión arquitectónica

Se conserva el flujo oficial:

```text
WhatsApp → WAHA → Orchestrator → ELAN AI Runtime → Conversation Engine → CONNECT → Supabase
```

ECS-001 se implementa como una extensión del Orchestrator y del Conversation Engine. CONNECT continúa como fuente oficial de persistencia y el Conversation Hub como interfaz operacional. No se crea otro CRM ni otro sistema de conversaciones.

## Responsabilidades

### Orchestrator

- coordinar detección de compromisos;
- evaluar ownership AI/HUMAN;
- ejecutar el scheduler comercial;
- decidir responder, guardar silencio o escalar;
- enviar seguimientos mediante el adaptador WAHA existente;
- notificar privadamente al propietario.

### ELAN AI Runtime / Conversation Engine

- interpretar intención comercial;
- resumir memoria comercial;
- proponer estado y prioridad;
- generar mensajes naturales de seguimiento;
- detectar riesgo, molestia, objeciones y probabilidad de pérdida.

### CONNECT / Supabase

Persistir en las entidades oficiales de conversación:

- `commercialState`;
- `conversationOwner`;
- `priority`;
- `nextFollowUpAt`;
- `opportunityId`;
- `projectId`;
- `quotationId`;
- memoria comercial estructurada;
- historial de FollowUps;
- escalaciones y auditoría.

CONNECT debe exponer contratos idempotentes para crear, reclamar, completar, cancelar y reprogramar FollowUps. El Orchestrator no debe escribir directamente en Supabase.

## Contrato de ownership

```js
{
  conversationOwner: 'AI' | 'HUMAN',
  shouldReplyToCustomer: boolean,
  shouldScheduleFollowUps: boolean,
  shouldRecordContext: true,
  suppressionReason: string | null
}
```

Cuando el propietario toma una conversación:

- se persiste `conversationOwner = HUMAN`;
- se cancelan o suspenden FollowUps automáticos pendientes;
- los mensajes entrantes continúan registrándose;
- ELAN IA no responde al cliente;
- el copiloto privado permanece disponible para el propietario.

## Estados comerciales oficiales

```text
NEW
INTERESTED
QUALIFIED
QUOTE_REQUESTED
QUOTE_SENT
AWAITING_DECISION
PAYMENT_COMMITMENT
FOLLOW_UP
NEGOTIATION
WON
LOST
PAUSED
```

Las transiciones se validan mediante una máquina de estados. `WON` no puede volver arbitrariamente a negociación. `LOST` puede reabrirse únicamente como nueva oportunidad o recuperación explícita.

## FollowUp mínimo

```js
{
  id,
  conversationId,
  customerId,
  opportunityId,
  projectId,
  quotationId,
  dueAt,
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL',
  reason,
  confidence,
  sourceMessageId,
  status: 'PENDING' | 'CLAIMED' | 'COMPLETED' | 'CANCELLED' | 'FAILED',
  attempts,
  lastAttemptAt,
  completedAt,
  idempotencyKey
}
```

## Scheduler comercial

El scheduler debe:

1. consultar en CONNECT FollowUps vencidos y reclamables;
2. reclamarlos con bloqueo/idempotencia;
3. volver a cargar conversación, ownership y mensajes recientes;
4. cancelar ejecución si `conversationOwner = HUMAN`;
5. cancelar ejecución si el cliente respondió después de crearse el FollowUp;
6. generar mensaje contextual mediante ELAN AI;
7. validar políticas comerciales y frecuencia;
8. enviar por WAHA;
9. registrar resultado en CONNECT;
10. escalar al propietario cuando corresponda.

Frecuencia recomendada inicial: cada 5 minutos. El proceso debe ser singleton o usar reclamación atómica desde CONNECT para impedir mensajes duplicados.

## Reglas antiacoso

- no más de un seguimiento automático por oportunidad en 24 horas;
- máximo configurable de intentos consecutivos sin respuesta;
- detener al detectar rechazo explícito;
- detener en estados WON, LOST o PAUSED;
- respetar horario comercial configurable;
- ningún seguimiento cuando ownership sea HUMAN;
- todo mensaje debe continuar el contexto existente, nunca reiniciar preguntas.

## Integración pendiente sobre la rama

1. Adaptador CONNECT para estado, ownership, memoria y FollowUps.
2. Contrato `shouldReply` en `messageService`.
3. Soporte de silencio explícito en `wahaWebhookApi`.
4. Owner commands vinculados a una conversación objetivo.
5. Worker/scheduler comercial inicializado desde `server.js`.
6. Endpoints de lectura para Conversation Hub.
7. Pruebas integrales con adaptadores simulados antes de cualquier despliegue.
