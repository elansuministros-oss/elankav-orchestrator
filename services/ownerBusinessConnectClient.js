'use strict';

class OwnerBusinessConnectError extends Error {
  constructor(code, message, statusCode, details = null) {
    super(message || code || 'OWNER_BUSINESS_CONNECT_ERROR');
    this.name = 'OwnerBusinessConnectError';
    this.code = code || 'OWNER_BUSINESS_CONNECT_ERROR';
    this.statusCode = statusCode || 500;
    this.details = details;
  }
}

function config(env = process.env) {
  const baseUrl = String(env.CONNECT_BASE_URL || 'https://connect.elankav.com').trim().replace(/\/+$/, '');
  const token = String(env.VQS_API_TOKEN || '').trim();
  if (!token) throw new OwnerBusinessConnectError('VQS_API_TOKEN_REQUIRED', 'No está configurada la credencial interna de CONNECT.', 503);
  return { baseUrl, token };
}
function headers(token, extra = {}) { return { Accept:'application/json', Authorization:`Bearer ${token}`, 'Content-Type':'application/json', 'X-Elankav-Platform':'ELAN_IA', 'X-Elankav-Actor-Type':'owner', 'X-Elankav-Role':'owner', 'X-Elankav-User-Id':'owner-whatsapp', 'X-Elankav-Source':'OWNER_WHATSAPP', ...extra }; }
function assertAllowedPath(path, method) { const normalizedPath=String(path||''); if(normalizedPath.startsWith('/api/v1/business/vqs/'))return; if(normalizedPath.startsWith('/api/v1/providers')&&method==='GET')return; throw new OwnerBusinessConnectError('CONNECT_PATH_NOT_ALLOWED','Ruta no autorizada para Owner Business Gateway.',403); }
async function requestConnect(path, options = {}, env = process.env) {
  const { baseUrl, token }=config(env); const method=String(options.method||'GET').toUpperCase();
  if(!['GET','POST','PATCH','DELETE','PUT'].includes(method))throw new OwnerBusinessConnectError('CONNECT_METHOD_NOT_ALLOWED','Método no autorizado para Owner Business Gateway.',405);
  assertAllowedPath(path,method);
  const response=await fetch(`${baseUrl}${path}`,{method,headers:headers(token,options.headers||{}),...(options.body===undefined?{}:{body:JSON.stringify(options.body)})});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){const nested=payload&&typeof payload.error==='object'?payload.error:{};const code=String(payload.code||nested.code||'CONNECT_REQUEST_FAILED');const message=String((typeof payload.error==='string'?payload.error:nested.message)||payload.message||'CONNECT rechazó la operación.');throw new OwnerBusinessConnectError(code,message,response.status,nested.details||payload.details||null)}
  return payload;
}
function query(value){return encodeURIComponent(String(value||'').trim())}
function paramsFrom(filters={}){const params=new URLSearchParams();for(const[key,value]of Object.entries(filters))if(value!==undefined&&value!==null&&String(value).trim())params.set(key,String(value));return params.toString()?`?${params.toString()}`:''}
function normalizeQuotationSource(document){const input=document&&typeof document==='object'?document:{};const quotation=input.quotation&&typeof input.quotation==='object'?input.quotation:{};const source=quotation.source&&typeof quotation.source==='object'?quotation.source:{};if(String(source.type||'').trim().toLowerCase()!=='owner-whatsapp')return input;return{...input,quotation:{...quotation,source:{...source,type:'manual',channel:source.channel||'owner-whatsapp'}}}}

async function searchCustomers(term,env){return requestConnect(`/api/v1/business/vqs/customers/directory-search?q=${query(term)}&limit=30`,{},env)}
async function listCustomers(env){return requestConnect('/api/v1/business/vqs/customers/official',{},env)}
async function createCustomer(input,env){return requestConnect('/api/v1/business/vqs/customers',{method:'POST',body:input},env)}
async function listOwnerCustomers(term='',env){return requestConnect(`/api/v1/business/vqs/owner-directory/customers${term?`?q=${query(term)}`:''}`,{},env)}
async function createOwnerCustomer(input,env){return requestConnect('/api/v1/business/vqs/owner-directory/customers',{method:'POST',body:input},env)}
async function updateOwnerCustomer(id,input,env){return requestConnect(`/api/v1/business/vqs/owner-directory/customers/${query(id)}`,{method:'PATCH',body:input},env)}
async function deactivateOwnerCustomer(id,env){return requestConnect(`/api/v1/business/vqs/owner-directory/customers/${query(id)}/deactivate`,{method:'POST',body:{}},env)}

async function listProviders(filters={},env){return requestConnect(`/api/v1/providers${paramsFrom({status:'active',...filters})}`,{},env)}
async function searchProviders(term,env){return listProviders({search:term},env)}
async function listOwnerProviders(term='',env){return requestConnect(`/api/v1/business/vqs/owner-directory/providers${term?`?q=${query(term)}`:''}`,{},env)}
async function createOwnerProvider(input,env){return requestConnect('/api/v1/business/vqs/owner-directory/providers',{method:'POST',body:input},env)}
async function updateOwnerProvider(id,input,env){return requestConnect(`/api/v1/business/vqs/owner-directory/providers/${query(id)}`,{method:'PATCH',body:input},env)}
async function deactivateOwnerProvider(id,env){return requestConnect(`/api/v1/business/vqs/owner-directory/providers/${query(id)}/deactivate`,{method:'POST',body:{}},env)}

async function listOwnerSellers(term='',env){return requestConnect(`/api/v1/business/vqs/owner-directory/sellers${term?`?q=${query(term)}`:''}`,{},env)}
async function createOwnerSeller(input,env){return requestConnect('/api/v1/business/vqs/owner-directory/sellers',{method:'POST',body:input},env)}
async function updateOwnerSeller(id,input,env){return requestConnect(`/api/v1/business/vqs/owner-directory/sellers/${query(id)}`,{method:'PATCH',body:input},env)}
async function deactivateOwnerSeller(id,env){return requestConnect(`/api/v1/business/vqs/owner-directory/sellers/${query(id)}/deactivate`,{method:'POST',body:{}},env)}
async function deleteOwnerSeller(id,env){return requestConnect(`/api/v1/business/vqs/owner-directory/sellers/${query(id)}`,{method:'DELETE'},env)}
async function setOwnerSellerPlatforms(id,platforms,env){return requestConnect(`/api/v1/business/vqs/owner-directory/sellers/${query(id)}/platforms`,{method:'PUT',body:{platforms}},env)}

async function listOwnerFamily(term='',env){return requestConnect(`/api/v1/business/vqs/owner-directory/family${term?`?q=${query(term)}`:''}`,{},env)}
async function createOwnerFamily(input,env){return requestConnect('/api/v1/business/vqs/owner-directory/family',{method:'POST',body:input},env)}
async function updateOwnerFamily(id,input,env){return requestConnect(`/api/v1/business/vqs/owner-directory/family/${query(id)}`,{method:'PATCH',body:input},env)}
async function deactivateOwnerFamily(id,env){return requestConnect(`/api/v1/business/vqs/owner-directory/family/${query(id)}/deactivate`,{method:'POST',body:{}},env)}
async function searchOwnerContacts(term,env){return requestConnect(`/api/v1/business/vqs/owner-directory/contacts?q=${query(term)}`,{},env)}
async function sendOwnerWhatsApp(input,env){return requestConnect('/api/v1/business/vqs/owner-directory/send-whatsapp',{method:'POST',body:input},env)}

async function resolveCatalogPricing(input,env){return requestConnect('/api/v1/business/vqs/pricing/resolve',{method:'POST',body:input},env)}
async function listAuthorizedPrices(term,env){return requestConnect(`/api/v1/business/vqs/pricing/catalog-admin/search?q=${query(term)}`,{},env)}
async function listQuotations(env){return requestConnect('/api/v1/business/vqs/quotations?limit=200',{},env)}
async function getQuotation(projectId,env){return requestConnect(`/api/v1/business/vqs/quotations/${query(projectId)}`,{},env)}
async function createQuotation(document,idempotencyKey,env){const key=String(idempotencyKey||'').trim();const body=normalizeQuotationSource(document);return requestConnect('/api/v1/business/vqs/quotations',{method:'POST',body,headers:key?{'Idempotency-Key':key}:{}},env)}
async function updateQuotation(projectId,document,env){return requestConnect(`/api/v1/business/vqs/quotations/${query(projectId)}`,{method:'PATCH',body:document},env)}
async function uploadQuotationImage(projectId,body,env){return requestConnect(`/api/v1/business/vqs/quotations/${query(projectId)}/media`,{method:'POST',body},env)}
async function removeQuotationImage(projectId,body={},env){return requestConnect(`/api/v1/business/vqs/quotations/${query(projectId)}/media`,{method:'DELETE',body},env)}
async function sendQuotationWhatsApp(projectId,body={},env){return requestConnect(`/api/v1/business/vqs/quotations/${query(projectId)}/send-whatsapp`,{method:'POST',body},env)}

async function createDesignRequest(payload,env){return requestConnect('/api/v1/business/vqs/owner-design',{method:'POST',body:{type:'design-request',...payload}},env)}
async function getDesignRequest(requestCode,accessToken,env){return requestConnect('/api/v1/business/vqs/owner-design',{method:'POST',body:{type:'design-status',requestCode,accessToken}},env)}
async function reviseDesignRequest(requestCode,accessToken,action,instructions,env){return requestConnect('/api/v1/business/vqs/owner-design',{method:'POST',body:{type:'design-request-action',requestCode,accessToken,action,instructions}},env)}
async function sendDesignWhatsApp(requestCode,accessToken,phone,caption,env){return requestConnect('/api/v1/business/vqs/owner-design/send-whatsapp',{method:'POST',body:{requestCode,accessToken,phone,...(caption?{caption}:{})}},env)}
async function createAndProcessDesign(payload,env){const created=await createDesignRequest(payload,env);const result=created?.result||created?.data?.result||created?.data||{};const requestCode=String(result.requestCode||'').trim();const accessToken=String(result.accessToken||'').trim();if(!requestCode||!accessToken)return{created,processed:null};const processed=await getDesignRequest(requestCode,accessToken,env);return{created,processed,requestCode,accessToken};}

async function listPayments(projectId,env){return requestConnect(`/api/v1/business/vqs/quotations/${query(projectId)}/payments`,{},env)}
async function applyPayment(projectId,body,env){return requestConnect(`/api/v1/business/vqs/quotations/${query(projectId)}/payments`,{method:'POST',body},env)}
async function getPayment(projectId,paymentId,env){return requestConnect(`/api/v1/business/vqs/quotations/${query(projectId)}/payments/${query(paymentId)}`,{},env)}
async function listWorkOrders(projectId,env){return requestConnect(`/api/v1/business/vqs/quotations/${query(projectId)}/work-orders`,{},env)}
async function createWorkOrder(projectId,body={},env){return requestConnect(`/api/v1/business/vqs/quotations/${query(projectId)}/work-orders`,{method:'POST',body},env)}
async function listPriceAuthorizations(filters={},env){return requestConnect(`/api/v1/business/vqs/price-authorizations${paramsFrom(filters)}`,{},env)}
async function createPriceAuthorization(input,env){return requestConnect('/api/v1/business/vqs/price-authorizations',{method:'POST',body:input},env)}
async function revokePriceAuthorization(authorizationId,env){return requestConnect(`/api/v1/business/vqs/price-authorizations/${query(authorizationId)}/revoke`,{method:'POST',body:{}},env)}
async function listLogisticsRules(filters={},env){return requestConnect(`/api/v1/business/vqs/logistics-rules${paramsFrom(filters)}`,{},env)}
async function createLogisticsRule(input,env){return requestConnect('/api/v1/business/vqs/logistics-rules',{method:'POST',body:input},env)}

module.exports={
  OwnerBusinessConnectError,applyPayment,createAndProcessDesign,createCustomer,createDesignRequest,createLogisticsRule,createOwnerCustomer,createOwnerFamily,createOwnerProvider,createOwnerSeller,createPriceAuthorization,createQuotation,createWorkOrder,
  deactivateOwnerCustomer,deactivateOwnerFamily,deactivateOwnerProvider,deactivateOwnerSeller,deleteOwnerSeller,getDesignRequest,getPayment,getQuotation,listAuthorizedPrices,listCustomers,listLogisticsRules,listOwnerCustomers,listOwnerFamily,listOwnerProviders,listOwnerSellers,listPayments,listPriceAuthorizations,listProviders,listQuotations,listWorkOrders,
  normalizeQuotationSource,removeQuotationImage,requestConnect,resolveCatalogPricing,reviseDesignRequest,revokePriceAuthorization,searchCustomers,searchOwnerContacts,searchProviders,sendDesignWhatsApp,sendOwnerWhatsApp,sendQuotationWhatsApp,setOwnerSellerPlatforms,updateOwnerCustomer,updateOwnerFamily,updateOwnerProvider,updateOwnerSeller,updateQuotation,uploadQuotationImage
};
