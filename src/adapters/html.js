export function planHtmlBuild(project) {
  return {
    format: "html",
    project: project.project.name,
    pages: project.pages.map((page) => ({
      page: page.page,
      title: page.screen_text.title,
      relation: page.relation,
      renderer: "html"
    }))
  };
}
