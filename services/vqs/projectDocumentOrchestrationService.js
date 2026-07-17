class ProjectDocumentOrchestrationService {
  constructor({ projectService, documentBuilder, documentDeliveryService = null } = {}) {
    if (!projectService) throw new Error('ProjectDocumentOrchestrationService requiere projectService');
    if (!documentBuilder) throw new Error('ProjectDocumentOrchestrationService requiere documentBuilder');
    if (documentDeliveryService && typeof documentDeliveryService.deliver !== 'function') {
      throw new Error('documentDeliveryService debe implementar deliver()');
    }
    this.projectService = projectService;
    this.documentBuilder = documentBuilder;
    this.documentDeliveryService = documentDeliveryService;
  }

  async create(input, actor = {}) {
    const result = await this.projectService.create(input, actor);
    const quotationDocument = this.documentBuilder.build(result);
    const documentDelivery = this.documentDeliveryService
      ? await this.documentDeliveryService.deliver({
          quotationDocument,
          quotation: result.quotation,
          project: result.project
        })
      : null;

    return { ...result, quotationDocument, documentDelivery };
  }

  async updateProject(projectId, patch, actor = {}) {
    return this.projectService.updateProject(projectId, patch, actor);
  }
}

module.exports = { ProjectDocumentOrchestrationService };
