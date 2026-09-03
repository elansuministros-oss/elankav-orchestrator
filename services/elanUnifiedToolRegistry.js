'use strict';

const connect = require('./ownerBusinessConnectClient');
const seller = require('./sellerBusinessConnectClient');
const marketplaceAutonomy = require('./elanMarketplaceAutonomyService');

const searchParam = { type:'object', properties:{ query:{ type:'string' } }, additionalProperties:false };
const qParam = { type:'object', properties:{ query:{ type:'string' } }, required:['query'], additionalProperties:false };
const idPatchParam = (idField) => ({ type:'object', properties:{ [idField]:{type:'string'}, data:{type:'object'} }, required:[idField,'data'], additionalProperties:false });
const idOnlyParam = (idField) => ({ type:'object', properties:{ [idField]:{type:'string'} }, required:[idField], additionalProperties:false });

const TOOL_DEFINITIONS = Object.freeze([
  { name:'buscar_precio_autorizado', description:'Busca exclusivamente el precio comercial autorizado y publicado en CONNECT. Nunca estima ni inventa.', scope:'price.authorized.read', sellerAllowed:true, parameters:{type:'object',properties:{query:{type:'string'},width:{type:'number'},height:{type:'number'},quantity:{type:'number'}},required:['query'],additionalProperties:false}},
  { name:'listar_precios_autorizados', description:'Lista coincidencias del catálogo comercial autorizado de ELANVISUAL.', scope:'price.authorized.read', parameters:qParam },
  { name:'buscar_material_catalogo', description:'Busca materiales e insumos reales del catálogo maestro de CONNECT para una plataforma e incluye el proveedor relacionado cuando existe. Úsala también para responder quién vende, tiene o suministra un material. Es solo lectura y no inventa precios.', ownerOnly:true, parameters:{type:'object',properties:{query:{type:'string'},platform:{type:'string'},limit:{type:'number'}},required:['query'],additionalProperties:false}},
  { name:'solicitar_presupuesto', description:'Prepara un presupuesto PREVIEW para vendedor usando exclusivamente precios autorizados de CONNECT. No crea una cotización.', sellerOnly:true, parameters:{type:'object',properties:{items:{type:'array',items:{type:'object'}}},required:['items'],additionalProperties:false}},
  { name:'buscar_cliente', description:'Busca clientes oficiales o lista todos si no se especifica query. Para vendedor solo devuelve sus clientes asignados.', scope:'customer.read', sellerAllowed:true, parameters:searchParam },
  { name:'crear_cliente', description:'Crea un cliente oficial en CONNECT. Para vendedor queda asignado a su sellerId.', scope:'customer.write', sellerAllowed:true, parameters:{type:'object',properties:{data:{type:'object'}},required:['data'],additionalProperties:false}},
  { name:'editar_cliente', description:'Edita un cliente oficial. El vendedor solo puede editar clientes asignados a su sellerId.', scope:'customer.write', sellerAllowed:true, parameters:idPatchParam('customerId') },
  { name:'desactivar_cliente', description:'Desactiva un cliente conservando trazabilidad histórica.', ownerOnly:true, parameters:idOnlyParam('customerId') },
  { name:'buscar_proveedor', description:'Busca proveedores oficiales por su nombre o datos propios, o lista todos. No usar para descubrir qué proveedor vende un material; para eso usar buscar_material_catalogo.', scope:'provider.read', parameters:searchParam },
  { name:'crear_proveedor', description:'Crea un proveedor oficial.', ownerOnly:true, parameters:{type:'object',properties:{data:{type:'object'}},required:['data'],additionalProperties:false}},
  { name:'editar_proveedor', description:'Edita un proveedor oficial.', ownerOnly:true, parameters:idPatchParam('providerId') },
  { name:'desactivar_proveedor', description:'Desactiva un proveedor sin borrar el historial.', ownerOnly:true, parameters:idOnlyParam('providerId') },
  { name:'buscar_vendedor', description:'Busca vendedores oficiales o lista todos.', ownerOnly:true, parameters:searchParam },
  { name:'crear_vendedor', description:'Crea un vendedor oficial.', ownerOnly:true, parameters:{type:'object',properties:{data:{type:'object'}},required:['data'],additionalProperties:false}},
  { name:'editar_vendedor', description:'Edita un vendedor oficial.', ownerOnly:true, parameters:idPatchParam('sellerId') },
  { name:'desactivar_vendedor', description:'Desactiva un vendedor conservando ventas y comisiones históricas.', ownerOnly:true, parameters:idOnlyParam('sellerId') },
  { name:'eliminar_vendedor', description:'Elimina físicamente un vendedor solo cuando CONNECT confirma que no tiene historial comercial relacionado.', ownerOnly:true, parameters:idOnlyParam('sellerId') },
  { name:'configurar_plataformas_vendedor', description:'Configura plataformas, comisión y bono de un vendedor.', ownerOnly:true, parameters:{type:'object',properties:{sellerId:{type:'string'},platforms:{type:'array',items:{type:'object'}}},required:['sellerId','platforms'],additionalProperties:false}},
  { name:'buscar_familiar', description:'Busca familiares autorizados o lista todos.', ownerOnly:true, parameters:searchParam },
  { name:'crear_familiar', description:'Crea un familiar autorizado y sus accesos.', ownerOnly:true, parameters:{type:'object',properties:{data:{type:'object'}},required:['data'],additionalProperties:false}},
  { name:'editar_familiar', description:'Edita datos o permisos de un familiar autorizado.', ownerOnly:true, parameters:idPatchParam('familyId') },
  { name:'desactivar_familiar', description:'Desactiva un familiar autorizado.', ownerOnly:true, parameters:idOnlyParam('familyId') },
  { name:'buscar_contacto', description:'Busca simultáneamente clientes, proveedores, vendedores y familia.', ownerOnly:true, parameters:searchParam },
  { name:'enviar_mensaje_whatsapp', description:'Envía un mensaje WhatsApp a un contacto oficial resuelto por tipo, id o nombre. Solo confirma si CONNECT/WAHA confirma entrega.', ownerOnly:true, parameters:{type:'object',properties:{recipientType:{type:'string',enum:['customer','provider','seller','family']},recipientId:{type:'string'},query:{type:'string'},text:{type:'string'}},required:['text'],additionalProperties:false}},
  { name:'buscar_cotizacion', description:'Consulta cotizaciones oficiales. Para vendedor solo consulta sus propias cotizaciones.', scope:'quotation.read', sellerAllowed:true, parameters:{type:'object',properties:{projectId:{type:'string'}},additionalProperties:false}},
  { name:'crear_cotizacion', description:'Crea una cotización oficial. Para vendedor CONNECT revalida cliente propio y cada precio autorizado antes de guardar.', scope:'quotation.write', sellerAllowed:true, parameters:{type:'object',properties:{document:{type:'object'},idempotencyKey:{type:'string'}},required:['document'],additionalProperties:false}},
  { name:'editar_cotizacion', description:'Actualiza una cotización oficial. El vendedor solo puede editar una cotización propia y todos los precios se vuelven a validar.', scope:'quotation.write', sellerAllowed:true, parameters:{type:'object',properties:{projectId:{type:'string'},document:{type:'object'}},required:['projectId','document'],additionalProperties:false}},
  { name:'cargar_imagen_cotizacion', description:'Carga o reemplaza una imagen de una cotización en borrador.', ownerOnly:true, parameters:{type:'object',properties:{projectId:{type:'string'},imageBase64:{type:'string'},mimeType:{type:'string'},filename:{type:'string'},itemId:{type:'string'},mode:{type:'string',enum:['add','replace']}},required:['projectId','imageBase64','mimeType'],additionalProperties:false}},
  { name:'quitar_imagen_cotizacion', description:'Quita la imagen de un ítem de cotización en borrador.', ownerOnly:true, parameters:{type:'object',properties:{projectId:{type:'string'},itemId:{type:'string'}},required:['projectId'],additionalProperties:false}},
  { name:'enviar_cotizacion_cliente', description:'Envía una cotización oficial al WhatsApp del cliente.', ownerOnly:true, parameters:{type:'object',properties:{projectId:{type:'string'},body:{type:'object'}},required:['projectId'],additionalProperties:false}},
  { name:'crear_propuesta_diseno', description:'Crea y procesa una propuesta en el motor oficial de diseño de CONNECT, devolviendo el resultado generado cuando está disponible.', ownerOnly:true, parameters:{type:'object',properties:{customer:{type:'object'},project:{type:'object'},files:{type:'array',items:{type:'object'}},source:{type:'string'}},required:['project'],additionalProperties:false}},
  { name:'consultar_propuesta_diseno', description:'Consulta estado y resultado de una propuesta de diseño.', ownerOnly:true, parameters:{type:'object',properties:{requestCode:{type:'string'},accessToken:{type:'string'}},required:['requestCode','accessToken'],additionalProperties:false}},
  { name:'revisar_propuesta_diseno', description:'Solicita revisión o render de una propuesta existente.', ownerOnly:true, parameters:{type:'object',properties:{requestCode:{type:'string'},accessToken:{type:'string'},action:{type:'string'},instructions:{type:'string'}},required:['requestCode','accessToken','action','instructions'],additionalProperties:false}},
  { name:'enviar_propuesta_diseno', description:'Envía por WhatsApp una propuesta de diseño ya generada usando su código interno de solicitud y el teléfono destino.', ownerOnly:true, parameters:{type:'object',properties:{requestCode:{type:'string'},phone:{type:'string'},caption:{type:'string'}},required:['requestCode','phone'],additionalProperties:false}},
  { name:'buscar_orden_trabajo', description:'Lista órdenes de trabajo de una cotización/proyecto.', scope:'work_order.read', parameters:{type:'object',properties:{projectId:{type:'string'}},required:['projectId'],additionalProperties:false}},
  { name:'marketplace_gestionar_necesidad', description:'ELAN registra una necesidad en CONNECT, ejecuta matching y, si no existe candidato, busca ofertas externas de forma autónoma.', ownerOnly:true, parameters:{type:'object',properties:{requesterPartyId:{type:'string'},requesterRefType:{type:'string'},requesterRefId:{type:'string'},title:{type:'string'},description:{type:'string'},category:{type:'string'},subcategory:{type:'string'},intent:{type:'string'},budget:{type:'object'},preferredLocation:{type:'object'},requirements:{type:'object'},priority:{type:'string'},source:{type:'string'},expiresAt:{type:'string'}},required:['title','category','subcategory','intent'],additionalProperties:false}},
  { name:'marketplace_crear_consulta', description:'Registra en CONNECT el interés real de una identidad existente sobre un activo público. ELAN no inventa identidades.', ownerOnly:true, parameters:{type:'object',properties:{assetCode:{type:'string'},requesterPartyId:{type:'string'},requesterRefType:{type:'string'},requesterRefId:{type:'string'},action:{type:'string',enum:['request_information','make_offer','want_to_buy','want_to_rent','schedule_visit','talk_to_elan']},offerAmount:{type:'object'},message:{type:'string'}},required:['assetCode','action'],additionalProperties:false}},
  { name:'consultar_pago', description:'Consulta pagos oficiales de una cotización/proyecto.', scope:'payment.read', parameters:{type:'object',properties:{projectId:{type:'string'},paymentId:{type:'string'}},required:['projectId'],additionalProperties:false}}
]);

function scopesOf(actor={}){return Array.isArray(actor.scopes)?actor.scopes.map(value=>String(value)):[]}
function isOwner(actor={}){return String(actor.role||'').toLowerCase()==='owner'||String(actor.authority||'').toLowerCase()==='owner_identity'}
function isSeller(actor={}){return String(actor.role||'').toLowerCase()==='seller'}
function isAllowed(definition,actor={}){
  if(definition.sellerOnly)return isSeller(actor);
  if(definition.ownerOnly)return isOwner(actor);
  if(isOwner(actor))return true;
  if(isSeller(actor)&&definition.sellerAllowed)return true;
  const scopes=scopesOf(actor);
  return scopes.includes('*')||!definition.scope||scopes.includes(definition.scope);
}
function getToolManifest(actor={}){return TOOL_DEFINITIONS.filter(definition=>isAllowed(definition,actor)).map(definition=>({type:'function',name:definition.name,description:definition.description,parameters:definition.parameters}))}
function requiredText(value,field){const normalized=String(value||'').trim();if(!normalized){const error=new Error(`Falta ${field}.`);error.code='ELAN_TOOL_ARGUMENT_REQUIRED';error.statusCode=400;throw error}return normalized}
function requiredObject(value,field='data'){if(!value||typeof value!=='object'||Array.isArray(value)){const error=new Error(`Falta ${field}.`);error.code='ELAN_TOOL_ARGUMENT_REQUIRED';error.statusCode=400;throw error}return value}
function optionalText(value){return String(value||'').trim()}

async function executeTool({actor={},tool,arguments:args={},env=process.env}={}){
  const name=String(tool||'').trim();const definition=TOOL_DEFINITIONS.find(candidate=>candidate.name===name);
  if(!definition)throw Object.assign(new Error(`La herramienta ${name||'(vacía)'} todavía no está disponible en ELAN Runtime.`),{code:'ELAN_TOOL_NOT_AVAILABLE',statusCode:404});
  if(!isAllowed(definition,actor))throw Object.assign(new Error('El actor no tiene permiso para ejecutar esta herramienta.'),{code:'ELAN_TOOL_FORBIDDEN',statusCode:403});
  const sellerActor=isSeller(actor);
  switch(name){
    case'buscar_precio_autorizado':{const input={query:requiredText(args.query,'query'),quantity:Number(args.quantity)>0?Number(args.quantity):1};if(Number(args.width)>0)input.width=Number(args.width);if(Number(args.height)>0)input.height=Number(args.height);return sellerActor?seller.resolveCatalogPricing(input,actor,env):connect.resolveCatalogPricing(input,env)}
    case'listar_precios_autorizados':return connect.listAuthorizedPrices(requiredText(args.query,'query'),env);
    case'buscar_material_catalogo':return connect.searchCatalogMaterials({query:requiredText(args.query,'query'),platform:optionalText(args.platform)||'ELANVISUAL',limit:Number(args.limit)||50},env);
    case'solicitar_presupuesto':return seller.prepareBudget(Array.isArray(args.items)?args.items:[],actor,env);
    case'buscar_cliente':return sellerActor?seller.listSellerCustomers(actor,optionalText(args.query),env):connect.listOwnerCustomers(optionalText(args.query),env);
    case'crear_cliente':return sellerActor?seller.createSellerCustomer(requiredObject(args.data),actor,env):connect.createOwnerCustomer(requiredObject(args.data),env);
    case'editar_cliente':return sellerActor?seller.updateSellerCustomer(requiredText(args.customerId,'customerId'),requiredObject(args.data),actor,env):connect.updateOwnerCustomer(requiredText(args.customerId,'customerId'),requiredObject(args.data),env);
    case'desactivar_cliente':return connect.deactivateOwnerCustomer(requiredText(args.customerId,'customerId'),env);
    case'buscar_proveedor':return connect.listOwnerProviders(optionalText(args.query),env);
    case'crear_proveedor':return connect.createOwnerProvider(requiredObject(args.data),env);
    case'editar_proveedor':return connect.updateOwnerProvider(requiredText(args.providerId,'providerId'),requiredObject(args.data),env);
    case'desactivar_proveedor':return connect.deactivateOwnerProvider(requiredText(args.providerId,'providerId'),env);
    case'buscar_vendedor':return connect.listOwnerSellers(optionalText(args.query),env);
    case'crear_vendedor':return connect.createOwnerSeller(requiredObject(args.data),env);
    case'editar_vendedor':return connect.updateOwnerSeller(requiredText(args.sellerId,'sellerId'),requiredObject(args.data),env);
    case'desactivar_vendedor':return connect.deactivateOwnerSeller(requiredText(args.sellerId,'sellerId'),env);
    case'eliminar_vendedor':return connect.deleteOwnerSeller(requiredText(args.sellerId,'sellerId'),env);
    case'configurar_plataformas_vendedor':return connect.setOwnerSellerPlatforms(requiredText(args.sellerId,'sellerId'),Array.isArray(args.platforms)?args.platforms:[],env);
    case'buscar_familiar':return connect.listOwnerFamily(optionalText(args.query),env);
    case'crear_familiar':return connect.createOwnerFamily(requiredObject(args.data),env);
    case'editar_familiar':return connect.updateOwnerFamily(requiredText(args.familyId,'familyId'),requiredObject(args.data),env);
    case'desactivar_familiar':return connect.deactivateOwnerFamily(requiredText(args.familyId,'familyId'),env);
    case'buscar_contacto':return connect.searchOwnerContacts(optionalText(args.query),env);
    case'enviar_mensaje_whatsapp':return connect.sendOwnerWhatsApp({...(args.recipientType?{recipientType:args.recipientType}:{}),...(args.recipientId?{recipientId:args.recipientId}:{}),...(args.query?{query:args.query}:{}),text:requiredText(args.text,'text')},env);
    case'buscar_cotizacion':return sellerActor?(args.projectId?seller.getQuotation(requiredText(args.projectId,'projectId'),actor,env):seller.listQuotations(actor,env)):(args.projectId?connect.getQuotation(requiredText(args.projectId,'projectId'),env):connect.listQuotations(env));
    case'crear_cotizacion':return sellerActor?seller.createQuotation(requiredObject(args.document,'document'),args.idempotencyKey,actor,env):connect.createQuotation(requiredObject(args.document,'document'),args.idempotencyKey,env);
    case'editar_cotizacion':return sellerActor?seller.updateQuotation(requiredText(args.projectId,'projectId'),requiredObject(args.document,'document'),actor,env):connect.updateQuotation(requiredText(args.projectId,'projectId'),requiredObject(args.document,'document'),env);
    case'cargar_imagen_cotizacion':return connect.uploadQuotationImage(requiredText(args.projectId,'projectId'),{imageBase64:requiredText(args.imageBase64,'imageBase64'),mimeType:requiredText(args.mimeType,'mimeType'),...(args.filename?{filename:args.filename}:{}),...(args.itemId?{itemId:args.itemId}:{}),...(args.mode?{mode:args.mode}:{})},env);
    case'quitar_imagen_cotizacion':return connect.removeQuotationImage(requiredText(args.projectId,'projectId'),args.itemId?{itemId:args.itemId}:{},env);
    case'enviar_cotizacion_cliente':return connect.sendQuotationWhatsApp(requiredText(args.projectId,'projectId'),args.body&&typeof args.body==='object'?args.body:{},env);
    case'crear_propuesta_diseno':return connect.createAndProcessDesign({customer:args.customer||{},project:requiredObject(args.project,'project'),files:Array.isArray(args.files)?args.files:[],source:args.source||'elan-unified-runtime'},env);
    case'consultar_propuesta_diseno':return connect.getDesignRequest(requiredText(args.requestCode,'requestCode'),requiredText(args.accessToken,'accessToken'),env);
    case'revisar_propuesta_diseno':return connect.reviseDesignRequest(requiredText(args.requestCode,'requestCode'),requiredText(args.accessToken,'accessToken'),requiredText(args.action,'action'),requiredText(args.instructions,'instructions'),env);
    case'enviar_propuesta_diseno':return connect.sendDesignWhatsApp(requiredText(args.requestCode,'requestCode'),'',requiredText(args.phone,'phone'),optionalText(args.caption),env);
    case'buscar_orden_trabajo':return connect.listWorkOrders(requiredText(args.projectId,'projectId'),env);
    case'marketplace_gestionar_necesidad':return marketplaceAutonomy.manageMarketplaceNeed(requiredObject(args,'arguments'),env);
    case'marketplace_crear_consulta':return marketplaceAutonomy.createMarketplaceInquiry(requiredObject(args,'arguments'),env);
    case'consultar_pago':{const projectId=requiredText(args.projectId,'projectId');return args.paymentId?connect.getPayment(projectId,requiredText(args.paymentId,'paymentId'),env):connect.listPayments(projectId,env)}
    default:throw Object.assign(new Error('Herramienta no implementada.'),{code:'ELAN_TOOL_NOT_AVAILABLE',statusCode:404});
  }
}

module.exports={TOOL_DEFINITIONS,executeTool,getToolManifest,isAllowed,isOwner,isSeller};
