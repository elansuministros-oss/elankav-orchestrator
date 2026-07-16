class ProjectDocumentOrchestrationService {
  constructor({ projectService, documentBuilder } = {}) {
    if (!projectService) throw new Error('ProjectDocumentOrchestrationService requiere projectService');
    if (!documentBuilder) throw new Error('ProjectDocumentOrchestrationService requiere documentBuilder');
    this.projectService = projectService;
    this.documentBuilder = documentBuilder;
  }

  async create(input, actor = {}) {
    const result = await this.projectService.create(input, actor);
    const quotationDocument = this.documentBuilder.build(result);
    return { ...result, quotationDocument };
  }

  async updateProject(projectId, patch, actor = {}) {
    return this.projectService.updateProject(projectId, patch, actor);
  }
}

module.exports = { ProjectDocumentOrchestrationService };
