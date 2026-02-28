import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import type { Insight } from "@shared/schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scriptPath = path.resolve(__dirname, "..", "ml", "spending_variability.py");

export async function runSpendingVariabilityInsight(
  userId: string,
  monthKey: string
): Promise<Insight | null> {
  return new Promise((resolve) => {
    const child = spawn("python3", [scriptPath, "--user-id", userId, "--month", monthKey], {
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) {
        console.error("spending_variability.py failed:", stderr || stdout);
        return resolve(null);
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        return resolve(parsed as Insight);
      } catch (error) {
        console.error("Failed to parse variability insight:", error, stdout);
        return resolve(null);
      }
    });
  });
}
