async function main(args, api) {
  const readOne = async function main(args, api) {
  const file = await api.fs.readFile(args.path);
  const lines = file.content.split("\n");
  const start = (args.offset || 1) - 1;
  const count = args.limit || 200;
  if (start > lines.length) throw new Error("offset exceeds file length");
  let content = lines.slice(start, start + count).join("\n");
  if (content.length > 64000) throw new Error("Selected lines exceed 64000 characters; use a smaller line range");
  const end = Math.min(start + count, lines.length);
  return { path: file.path, revision: file.revision, content, totalLines: lines.length, ...(end < lines.length ? { nextOffset: end + 1 } : {}) };
};
  if (!Array.isArray(args.path)) return readOne(args, api);
  const files = [];
  for (const path of args.path) files.push(await readOne({ ...args, path }, api));
  return { files };
}