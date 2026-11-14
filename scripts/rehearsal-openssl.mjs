// Both TLS rehearsals need a real certificate authority. OpenSSL is the tool,
// but "is the word openssl present in PATH" proves nothing: on a Linux CI
// runner PATH usually does not contain the word, and a hard-coded Git-for-
// Windows path proves nothing there either. Resolve the binary for real by
// running it, trying the platform's well-known locations before giving up.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const CANDIDATES = [
  "openssl", // whatever PATH resolves it to (normal case on Linux)
  "/usr/bin/openssl",
  "/usr/local/bin/openssl",
  "/bin/openssl",
  "/opt/homebrew/bin/openssl", // Homebrew on macOS (arm64)
  "/usr/local/opt/openssl/bin/openssl", // Homebrew on macOS (intel)
  "C:/Program Files/Git/usr/bin/openssl.exe", // Git for Windows
];

export async function findOpenSSL() {
  for (const candidate of CANDIDATES) {
    try {
      await run(candidate, ["version"]);
      return candidate;
    } catch {
      // Not usable here; try the next candidate.
    }
  }
  throw new Error(
    "OpenSSL was not found. Install OpenSSL (ubuntu-latest ships it; on macOS use Homebrew; on Windows, Git for Windows bundles it) and re-run the rehearsal.",
  );
}
