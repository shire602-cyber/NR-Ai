// Preloaded into the soak test's child server (node --import). On SIGUSR2 it
// raises an unhandled promise rejection so the test can prove the server's
// process-level handler logs it instead of crashing the process.
process.on("SIGUSR2", () => {
  Promise.reject(new Error("harness-unhandled-rejection-probe"));
});
