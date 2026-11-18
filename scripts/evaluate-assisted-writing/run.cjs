// Retain the CLI used by the protected staff runner.
import("./run.mjs").then(({ main }) => main(process.argv.slice(2))).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
