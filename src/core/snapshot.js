export function normalizeSnapshot(projectRoot, snapshot) {
  const contracts = {
    project: snapshot["project.json"], sources: snapshot["sources.json"], outline: snapshot["outline.json"],
    pages: snapshot["pages.json"], theme: snapshot["theme.json"], assets: snapshot["assets.json"], templates: snapshot["templates.json"], ...(snapshot["fact-ledger.json"] ? { factLedger: snapshot["fact-ledger.json"] } : {})
  };
  const sourceById = new Map(contracts.sources.map((source) => [source.id, source]));
  return {
    root: projectRoot,
    project: { schema_version: "1.0", name: contracts.project.id, title: contracts.project.title, format: contracts.project.format, source_files: contracts.sources.map(({ file }) => file), theme_file: "theme.json", assets_file: "assets.json", outputs: contracts.project.outputs, ...(contracts.project.corporate_profile ? { corporate_profile: contracts.project.corporate_profile } : {}), ...(contracts.project.theme_override ? { theme_override: contracts.project.theme_override } : {}), ...(contracts.project.delivery_mode ? { delivery_mode: contracts.project.delivery_mode } : {}), ...(contracts.project.accessibility_profile ? { accessibility_profile: structuredClone(contracts.project.accessibility_profile) } : {}) },
    pages: contracts.pages.map((page) => {
      const reference = page.source_refs?.[0]; const source = reference ? sourceById.get(reference.source_id) : undefined;
      return { ...page, source: source ? `${source.file}${reference.locator ?? ""}` : undefined, html: page.renderers?.html, pptx: page.renderers?.pptx, status: page.content_status };
    }),
    theme: contracts.theme.tokens,
    assets: contracts.assets.map(({ contract_version, kind, bytes, mime, provenance, ...asset }) => asset),
    contractModel: "v1", ...(contracts.factLedger ? { factLedger: contracts.factLedger } : {}), contracts
  };
}
