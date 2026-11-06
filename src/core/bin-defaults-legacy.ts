// Exact pre-guidance manifests; only matching, unmodified defaults may be upgraded.
export const LEGACY_FILE_TOOL_MANIFESTS = [
  {
    "version": 1,
    "name": "read",
    "description": "Read UTF-8 files with revisions. path accepts one path string or an array of up to 32 paths; use an array to read independent files together. offset is a 1-based line number and limit defaults to 200. Follow nextOffset for more.",
    "parameters": {
      "type": "object",
      "required": [
        "path"
      ],
      "properties": {
        "path": {
          "anyOf": [
            {
              "type": "string",
              "minLength": 1,
              "maxLength": 1024
            },
            {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 1024
              },
              "minItems": 1,
              "maxItems": 32
            }
          ]
        },
        "offset": {
          "type": "integer",
          "minimum": 1
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
      "readFile"
    ]
  },
  {
    "version": 1,
    "name": "write",
    "description": "Write UTF-8 files. Use path/content for one file or files:[{path,content,expectedRevision?}] to create several files atomically in one call. Existing files require expectedRevision. createParents=true creates missing parent directories.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024
        },
        "content": {
          "type": "string",
          "maxLength": 524288
        },
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "createParents": {
          "type": "boolean"
        },
        "files": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "path",
              "content"
            ],
            "properties": {
              "path": {
                "type": "string",
                "minLength": 1,
                "maxLength": 1024
              },
              "content": {
                "type": "string",
                "maxLength": 524288
              },
              "expectedRevision": {
                "type": "integer",
                "minimum": 0
              }
            },
            "additionalProperties": false
          },
          "minItems": 1,
          "maxItems": 32
        }
      },
      "additionalProperties": false,
      "anyOf": [
        {
          "required": [
            "path",
            "content"
          ]
        },
        {
          "required": [
            "files"
          ]
        }
      ]
    },
    "capabilities": [
      "writeFile",
      "writeFiles",
      "mkdir"
    ]
  },
  {
    "version": 1,
    "name": "edit",
    "description": "Replace exact oldText in a file with newText. Ambiguous matches fail unless replaceAll is true. Uses revision conflict detection.",
    "parameters": {
      "type": "object",
      "required": [
        "path",
        "oldText",
        "newText"
      ],
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024
        },
        "oldText": {
          "type": "string",
          "minLength": 1
        },
        "newText": {
          "type": "string"
        },
        "replaceAll": {
          "type": "boolean"
        },
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        }
      },
      "additionalProperties": false
    },
    "capabilities": [
      "readFile",
      "writeFile"
    ]
  }
] as const;
