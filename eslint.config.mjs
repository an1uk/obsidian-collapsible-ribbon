import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  { ignores: ["node_modules/**", "tests/**", "main.js"] },
  ...obsidianmd.configs.recommended,
  {
    files: ["*.ts"],
    languageOptions: { parserOptions: { projectService: true } },
  },
];
