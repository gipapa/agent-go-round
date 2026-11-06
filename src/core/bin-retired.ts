// Exact retired defaults, retained only to clean up unmodified existing workspaces.
export const RETIRED_DEFAULT_BIN_TOOLS = [
  {
    "version": 1,
    "name": "shell_guide",
    "description": "Show the virtual Bash guide, available commands, builtins and limits.",
    "parameters": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    },
    "capabilities": [
      "commandHelp"
    ],
    "source": "async function main(args, api) { return { text: await api.tools.help(\"bash\") }; }"
  },
  {
    "version": 1,
    "name": "home",
    "description": "Return this agent's working directory to /home/user (~). Does not change the human Shell directory or another tab.",
    "parameters": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    },
    "capabilities": [
      "home"
    ],
    "source": "async function main(args, api) { return api.workspace.home(); }"
  },
  {
    "version": 1,
    "name": "ls",
    "description": "List immediate children of a directory, including hidden files. Default path is the current working directory.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024
        }
      },
      "additionalProperties": false
    },
    "capabilities": [
      "listDirectory"
    ],
    "source": "async function main(args, api) {\n  const entries = await api.fs.listDirectory(args.path || \".\");\n  return { entries: entries.map(({path, kind, revision}) => ({path, kind, revision})) };\n}"
  },
  {
    "version": 1,
    "name": "find",
    "description": "Find files and directories recursively. name is an optional basename glob (* and ?); type can be file or directory. Results are bounded.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024
        },
        "name": {
          "type": "string",
          "maxLength": 256
        },
        "type": {
          "anyOf": [
            {
              "type": "string",
              "const": "file"
            },
            {
              "type": "string",
              "const": "directory"
            }
          ]
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 500
        }
      },
      "additionalProperties": false
    },
    "capabilities": [
      "stat",
      "listDirectory"
    ],
    "source": "async function main(args, api) {\n  const pattern = args.name;\n  const match = (name) => {\n    if (pattern === undefined) return true;\n    let expression = \"^\";\n    for (const c of pattern) expression += c === \"*\" ? \".*\" : c === \"?\" ? \".\" : \"\\\\^$+.[(){}]|\".includes(c) ? \"\\\\\" + c : c;\n    return new RegExp(expression + \"$\", \"u\").test(name);\n  };\n  const queue = [await api.fs.stat(args.path || \".\")];\n  const entries = [];\n  const maximum = args.limit || 100;\n  while (queue.length) {\n    const node = queue.shift();\n    if ((!args.type || node.kind === args.type) && match(node.path.split(\"/\").pop())) {\n      if (entries.length >= maximum) return { entries, truncated: true };\n      entries.push({ path: node.path, kind: node.kind, revision: node.revision });\n    }\n    if (node.kind === \"directory\") queue.push(...await api.fs.listDirectory(node.path));\n  }\n  return { entries, truncated: false };\n}"
  },
  {
    "version": 1,
    "name": "grep",
    "description": "Search file contents recursively and return matching lines with paths and 1-based line numbers. Literal search by default; regex and ignoreCase are optional.",
    "parameters": {
      "type": "object",
      "required": [
        "pattern"
      ],
      "properties": {
        "pattern": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024
        },
        "path": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024
        },
        "regex": {
          "type": "boolean"
        },
        "ignoreCase": {
          "type": "boolean"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 500
        }
      },
      "additionalProperties": false
    },
    "capabilities": [
      "stat",
      "listDirectory",
      "readFile"
    ],
    "source": "async function main(args, api) {\n  const expression = args.regex ? new RegExp(args.pattern, args.ignoreCase ? \"iu\" : \"u\") : undefined;\n  const needle = args.ignoreCase ? args.pattern.toLowerCase() : args.pattern;\n  const queue = [await api.fs.stat(args.path || \".\")];\n  const matches = [];\n  const maximum = args.limit || 100;\n  while (queue.length) {\n    const node = queue.shift();\n    if (node.kind === \"directory\") { queue.push(...await api.fs.listDirectory(node.path)); continue; }\n    const file = await api.fs.readFile(node.path);\n    const lines = file.content.split(\"\\n\");\n    for (let index = 0; index < lines.length; index++) {\n      const line = lines[index];\n      if (expression ? expression.test(line) : (args.ignoreCase ? line.toLowerCase() : line).includes(needle)) {\n        if (matches.length >= maximum) return { matches, truncated: true };\n        if (line.length > 16000) throw new Error(\"Matching line exceeds 16000 characters\");\n        matches.push({ path: file.path, revision: file.revision, line: index + 1, text: line });\n      }\n    }\n  }\n  return { matches, truncated: false };\n}"
  },
  {
    "version": 1,
    "name": "open_preview",
    "description": "Open a VFS HTML file in a preview tab, or focus its existing preview. path defaults to ~/main.html; relative paths use this agent's working directory. Requires the app preview UI.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024
        }
      },
      "additionalProperties": false
    },
    "capabilities": [
      "openPreview"
    ],
    "source": "async function main(args, api) { return api.workspace.openPreview(args.path); }"
  }
] as const;
