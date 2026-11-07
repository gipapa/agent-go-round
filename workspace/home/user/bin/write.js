async function main(args, api) {
  const writeOne = async function main(args, api) {
  if (args.createParents) {
    const slash = args.path.lastIndexOf("/");
    if (slash > 0) await api.fs.mkdir(args.path.slice(0, slash), { recursive: true });
  }
  const file = await api.fs.writeFile(args.path, args.content, { expectedRevision: args.expectedRevision === undefined ? 0 : args.expectedRevision });
  return { path: file.path, revision: file.revision, bytes: file.size };
};
  if (!args.files) return writeOne(args, api);
  if (args.path !== undefined || args.content !== undefined) throw new Error("Use files or path/content, not both");
  if (args.createParents) {
    for (const file of args.files) {
      const slash = file.path.lastIndexOf("/");
      if (slash > 0) await api.fs.mkdir(file.path.slice(0, slash), { recursive: true });
    }
  }
  const files = await api.fs.writeFiles(args.files.map(file => ({ ...file, expectedRevision: file.expectedRevision === undefined ? 0 : file.expectedRevision })));
  return { files: files.map(file => ({ path: file.path, revision: file.revision, bytes: file.size })) };
}