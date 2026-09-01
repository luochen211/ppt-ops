export function planPptxBuild(project) {
  return {
    format: "pptx",
    project: project.project.name,
    editable: true,
    pages: project.pages.map((page) => ({
      page: page.page,
      title: page.screen_text.title,
      relation: page.relation,
      renderer: "pptx"
    }))
  };
}
