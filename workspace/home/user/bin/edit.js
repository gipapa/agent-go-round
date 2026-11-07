async function main(args, api) {
  const file = await api.fs.readFile(args.path);
  if (args.expectedRevision !== undefined && args.expectedRevision !== file.revision) throw new Error("File changed; read it again");
  const parts = file.content.split(args.oldText);
  const matches = parts.length - 1;
  if (!matches) throw new Error("oldText was not found; no changes made");
  if (matches > 1 && !args.replaceAll) throw new Error("oldText is ambiguous; include more context or set replaceAll");
  const content = parts.join(args.newText);
  const updated = await api.fs.writeFile(args.path, content, { expectedRevision: file.revision });
  return { path: updated.path, revision: updated.revision, replacements: matches };
}