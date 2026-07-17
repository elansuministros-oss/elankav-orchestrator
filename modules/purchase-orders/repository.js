class PurchaseOrderRepository {
  constructor({ adapter } = {}) {
    if (!adapter) throw new Error('PurchaseOrderRepository requiere adapter');
    this.adapter = adapter;
  }

  create(row) {
    return this.adapter.create(row);
  }

  list(filters) {
    return this.adapter.list(filters);
  }

  getById(id) {
    return this.adapter.getById(id);
  }

  update(id, patch) {
    return this.adapter.update(id, patch);
  }

  receive(id, receipt) {
    if (typeof this.adapter.receive === 'function') return this.adapter.receive(id, receipt);
    return this.adapter.update(id, receipt.patch || {});
  }
}

module.exports = { PurchaseOrderRepository };
