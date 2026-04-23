import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const tsconfigRootDir = new URL(".", import.meta.url).pathname;

export default [
  {
    ignores: ["dist/**", "node_modules/**", "public/graphify/**", "src/graphify/**"]
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir
      }
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }]
    }
  },
  {
    // Existing god-component/panel effects predate this lint gate; Batch 4 is scheduled to split them safely.
    files: [
      "src/app/App.tsx",
      "src/ui/AgentsPanel.tsx",
      "src/ui/ChatPanel.tsx",
      "src/ui/DocsPanel.tsx",
      "src/ui/HelpModal.tsx",
      "src/ui/LoadBalancersPanel.tsx",
      "src/ui/McpPanel.tsx",
      "src/ui/SkillsPanel.tsx"
    ],
    rules: {
      "react-hooks/exhaustive-deps": "off"
    }
  }
];
