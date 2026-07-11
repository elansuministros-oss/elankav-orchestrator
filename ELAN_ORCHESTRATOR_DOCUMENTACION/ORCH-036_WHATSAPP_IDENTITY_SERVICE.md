# ORCH-036 — WhatsApp Identity Service

## Estado

**VALIDADO EN PRODUCCIÓN — 11 de julio de 2026**

## Objetivo

Resolver identidades de WhatsApp aunque WAHA entregue identificadores internos `@lid` en lugar del número telefónico real.

La identidad operativa del ecosistema ELANKAV debe ser siempre una **identidad canónica**, resuelta antes de ingresar al Orchestrator.

## Problema confirmado

WAHA entregó para Erick Cano:

```text
215440458567779@lid
```

Ese valor no es un teléfono. Si se normaliza eliminando `@lid`, produce un identificador numérico falso y `ownerMode=false`.

La prueba directa al Orchestrator con:

```text
externalUserId=50588388940
```

sí reconocía correctamente al propietario.

## Arquitectura oficial

```text
WhatsApp
↓
WAHA
↓
/api/whatsapp
↓
WhatsApp Identity Bridge
↓
WhatsApp Identity Service
↓
Identidad canónica
↓
Orchestrator
↓
Context Router
↓
OpenAI
↓
WAHA sendText
↓
WhatsApp
```

## Regla principal

Nunca usar directamente como teléfono o identidad de negocio:

```text
@lid
@c.us
chatId
remoteJid
participant
```

Primero resolver el identificador externo a una identidad canónica.

## Identidad inicial validada

```text
Alias WAHA: 215440458567779@lid
ID canónico: 50588388940
Nombre: Erick Cano
Tipo: owner
Roles: owner
ownerMode: true
```

## Flujo validado

Entrada real desde WhatsApp:

```text
¿Quién soy para este sistema?
```

Respuesta validada:

```text
Sos Erick Cano, reconocido por el sistema como propietario del ecosistema ELANKAV.

Para este asistente no sos un cliente, lead ni prospecto: sos el titular interno al que asisto como asistente ejecutivo.
```

## Componentes implementados

Repositorio `elankav-core`:

```text
services/whatsappIdentityService.js
api/whatsapp-v2.js
api/whatsapp.js
vercel.json
```

Repositorio `elankav-orchestrator`:

```text
services/context/identityResolver.js
services/context/contextBuilder.js
services/messageService.js
services/openaiService.js
```

## Contrato de identidad

El Identity Service debe devolver como mínimo:

```json
{
  "receivedId": "215440458567779",
  "canonicalId": "50588388940",
  "name": "Erick Cano",
  "entityType": "owner",
  "roles": ["owner"],
  "matched": true,
  "source": "bootstrap"
}
```

## Extensión para futuras identidades

La misma capa debe resolver:

- propietarios;
- administradores;
- vendedores;
- proveedores;
- clientes;
- empleados;
- contactos de empresas;
- múltiples aliases por persona.

Configuración temporal admitida:

```text
ELANKAV_WHATSAPP_IDENTITIES_JSON
ELANKAV_IDENTITY_ALIASES_JSON
```

Fuente futura oficial:

```text
Supabase
```

La migración a Supabase no debe cambiar el contrato del Bridge ni del Orchestrator.

## Protocolo obligatorio de validación

### 1. Verificar versión pública

```bash
curl -s https://elankav-core.vercel.app/api/whatsapp
```

Debe devolver:

```json
{
  "service": "ELANKAV WhatsApp Identity Bridge",
  "version": "ORCH-036B",
  "status": "READY"
}
```

### 2. Probar el LID sin enviar respuesta

```bash
curl -sS -X POST \
  "https://elankav-core.vercel.app/api/whatsapp?dryRun=1" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message",
    "payload": {
      "from": "215440458567779@lid",
      "body": "¿Quién soy para este sistema?",
      "fromMe": false
    },
    "session": "ELANKAV"
  }'
```

Debe confirmar:

```text
canonicalId=50588388940
name=Erick Cano
entityType=owner
ownerMode=true
```

### 3. Validación real

Enviar desde WhatsApp:

```text
¿Quién soy para este sistema?
```

La respuesta debe reconocer a Erick Cano como propietario.

## Reglas para futuras conexiones

1. No identificar una persona únicamente por teléfono.
2. No tratar un `@lid` como teléfono.
3. Mantener el `chatId` original solo para responder por WAHA.
4. Usar el ID canónico para roles, CRM, permisos y contexto.
5. Registrar aliases de canal separados de la entidad de negocio.
6. Una persona puede tener varios aliases y canales.
7. Un alias debe resolver siempre a una sola identidad canónica activa.
8. Los roles se calculan después de resolver la identidad.
9. Los datos de identidad deben migrar a Supabase como fuente oficial.
10. Toda integración nueva debe incluir prueba técnica y prueba real.

## Alcance futuro

Este patrón será reutilizado para:

- WhatsApp;
- Telegram;
- Messenger;
- Instagram;
- correo electrónico;
- CRM;
- vendedores;
- proveedores;
- clientes;
- empleados;
- plataformas ELANKAV.

## Commits relacionados

### `elankav-orchestrator`

```text
9ce1fed1f2761e168ee5f8b699560b908ab2af2d
ORCH-034A propaga contexto owner hacia OpenAI

d6e4cd9f56aef9e7e580fe5234c0f108507c1b23
ORCH-034B integra contexto verificado en instrucciones OpenAI

b56f151d9018391687aee22e2ff7e4e3ca6728bd
ORCH-035A agrega resolver canónico de identidades

b7dd60cecb8a75568bee52950fa35914a62118d7
ORCH-035B integra identidad canónica en Context Builder
```

### `elankav-core`

```text
219e122dfe4e2bf615bb030e29ad3750cfbdcc41
Agrega auditoría temporal de identidad WAHA

e6f8cab0a91798e15697f7ff793f19a0adaf6f25
Crea WhatsApp Identity Service

b92fbaa3d208eb73130747b679a5e35b30cffc59
Crea WhatsApp Identity Bridge

6a3351749cf71b5b80abee64e7dcd6c9f98282f6
Configura ruta Vercel

38f4cbc27ca11df0eb262f706971d6d2b715fb3e
Conecta la ruta oficial al Identity Bridge
```

## Cierre

ORCH-036 queda cerrado únicamente porque se validaron:

- resolución del LID;
- identidad canónica;
- `ownerMode=true`;
- contexto entregado a OpenAI;
- respuesta correcta recibida en WhatsApp.

Este documento es la referencia oficial para futuras implementaciones de identidad y canales dentro del ecosistema ELANKAV.
