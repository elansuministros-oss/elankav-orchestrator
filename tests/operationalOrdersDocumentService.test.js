const test = require('node:test');
const assert = require('node:assert/strict');
const { OperationalOrdersDocumentService } = require('../services/operations/operationalOrdersDocumentService');

test('genera y persiste documento oficial OT usando el builder existente', async () => {
  const updates = [];
  const baseWorkOrder = {
    id: 'wo-1',
    workOrderNumber: 'OT-2026-000001',
    projectId: 'project-1',
    quotationId: 'quotation-1',
    status: 'pending',
    payload: {}
  };
  const ordersService = {
    adapter: {
      getProjectById() {
        return Promise.resolve({
          id: 'project-1',
          project_number: 'PRY-2026-000001',
          quotation_id: 'quotation-1',
          platform_id: 'ELANVISUAL',
          title: 'Rótulo',
          customer_snapshot: { name: 'Cliente' }
        });
      }
    },
    createWorkOrder() { return Promise.resolve(baseWorkOrder); },
    updateWorkOrder(projectId, workOrderId, patch) {
      updates.push({ projectId, workOrderId, patch });
      return Promise.resolve({ ...baseWorkOrder, payload: { ...baseWorkOrder.payload, ...patch.payload } });
    }
  };
  const documentBuilder = {
    build({ workOrder, project }) {
      return {
        documentType: 'work_order',
        workOrderNumber: workOrder.workOrderNumber,
        projectNumber: project.project_number
      };
    }
  };

  const service = new OperationalOrdersDocumentService({ ordersService, documentBuilder });
  const result = await service.createWorkOrder('project-1', {}, {});

  assert.equal(result.payload.officialDocument.documentType, 'work_order');
  assert.equal(result.payload.officialDocument.workOrderNumber, 'OT-2026-000001');
  assert.equal(updates[0].projectId, 'project-1');
  assert.equal(updates[0].workOrderId, 'wo-1');
});
