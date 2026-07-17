class WorkOrderRepository {
  constructor({ adapter } = {}) {
    if (!adapter) throw new Error('WorkOrderRepository requiere adapter');
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
}

module.exports = { WorkOrderRepository };
