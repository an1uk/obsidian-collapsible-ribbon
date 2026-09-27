import { context } from "esbuild";

const build = await context({
  entryPoints: ["./main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2018",
  outfile: "main.js",
  sourcemap: false,
  logLevel: "info",
});

if (process.argv.includes("--watch")) await build.watch();
else {
  await build.rebuild();
  await build.dispose();
}
