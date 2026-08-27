# ELANKAV Control para Visual Studio Code

Extensión inicial de solo lectura para consultar ELANKAV Orchestrator desde VS Code.

## Arquitectura

```text
Visual Studio Code
  ↓
ELANKAV Control
  ↓ túnel SSH local o HTTPS autenticado
ELANKAV Orchestrator
  ↓
Servicios autorizados
```

## Alcance VSC-001

Operaciones permitidas:

- salud del Orchestrator;
- dashboard ejecutivo;
- proyectos registrados;
- estado del ecosistema;
- estado GitHub;
- estado Docker.

No incluye escritura, despliegues, reinicios, comandos shell, modificaciones Git ni acceso directo a Supabase, WAHA o Docker.

## Conexión recomendada en VSC-001

El Orchestrator escucha internamente en `172.19.0.1:4100`. Para no publicar un endpoint nuevo antes de implementar autenticación IAM, usar un túnel SSH local:

```powershell
ssh -N -L 4100:172.19.0.1:4100 root@5.161.218.105
```

La extensión usa por defecto:

```text
http://127.0.0.1:4100
```

El túnel exige autenticación SSH y mantiene el Orchestrator sin exposición pública adicional.

## Uso en modo desarrollo

1. Abrir `integrations/vscode-extension` en VS Code.
2. Ejecutar `npm install`.
3. Ejecutar `npm test`.
4. Presionar `F5` para abrir Extension Development Host.
5. Ejecutar `ELANKAV: Configurar conexión`.
6. Consultar los comandos `ELANKAV:*` desde la paleta.

## Seguridad

- Lista cerrada de operaciones GET.
- Sin ejecución arbitraria de rutas.
- Token preparado para guardarse en `SecretStorage`.
- Tiempo máximo de consulta configurable.
- El token nunca se almacena en `settings.json`.
- VSC-001 recomienda túnel SSH hasta implementar `/api/vscode/*` con IAM.

## Próximo movimiento

`VSC-002` debe crear un contrato protegido en el Orchestrator:

```text
GET /api/vscode/capabilities
GET /api/vscode/health
GET /api/vscode/dashboard
...
```

Ese gateway deberá validar identidad, rol, permisos, token, alcance y auditoría antes de entregar datos.
