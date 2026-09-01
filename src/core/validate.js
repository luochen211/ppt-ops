const RELATIONS = new Set([
  "sequence", "parallel", "cause_effect", "before_after", "hierarchy",
  "process", "cycle", "comparison", "hero"
]);
const STATUSES = new Set(["draft", "prototype", "approved", "built", "reviewed"]);

export function validatePage(page) {
  const errors = [];
  if (!Number.isInteger(page.page) || page.page < 1) errors.push("page must be a positive integer");
  for (const field of ["task", "three_second_message", "visual_job"]) {
    if (typeof page[field] !== "string" || page[field].trim() === "") errors.push(`${field} is required`);
  }
  if (!RELATIONS.has(page.relation)) errors.push(`relation is invalid: ${page.relation}`);
  if (!page.screen_text || typeof page.screen_text.title !== "string" || page.screen_text.title.trim() === "") {
    errors.push("screen_text.title is required");
  }
  if (!STATUSES.has(page.status)) errors.push(`status is invalid: ${page.status}`);
  return errors;
}

export function validateProject(project) {
  const errors = [];
  if (!project.project?.name) errors.push("project.name is required");
  if (!Array.isArray(project.pages) || project.pages.length === 0) errors.push("pages must not be empty");
  const numbers = new Set();
  for (const page of project.pages ?? []) {
    for (const error of validatePage(page)) errors.push(`page ${page.page ?? "?"}: ${error}`);
    if (numbers.has(page.page)) errors.push(`duplicate page number: ${page.page}`);
    numbers.add(page.page);
  }
  return errors;
}
