import { generateCaption, generateScript } from "../src/lib/claude";
import { llmProviderName } from "../src/lib/llm";

const FIXTURE_TITLE = "5 daily habits that improve focus";
const FIXTURE_CONTENT = `Most people think focus is about raw willpower, but it's mostly about environment and energy management.

Habit 1: Plan tomorrow in 5 minutes before ending your day.
Habit 2: Start with one 25-minute deep-work sprint before checking messages.
Habit 3: Keep your phone out of sight during focus blocks.
Habit 4: Use a short walk between blocks to reset attention.
Habit 5: Review what actually moved the needle each evening.

Do these consistently for two weeks and your output quality usually improves faster than expected.`;

function activeModelName(provider: "anthropic" | "openai"): string {
  if (provider === "anthropic") {
    return process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  }

  return process.env.OPENAI_TEXT_MODEL || "gpt-6.1-terra";
}

async function main(): Promise<void> {
  const provider = llmProviderName();
  if (!provider) {
    throw new Error(
      "No text model configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY (or set LLM_PROVIDER explicitly)."
    );
  }

  const scriptResult = await generateScript({
    title: FIXTURE_TITLE,
    content: FIXTURE_CONTENT,
    targetDuration: 30,
    style: "informative",
    tone: "casual",
  });

  const instagramCaption = await generateCaption({
    script: scriptResult.script,
    platform: "instagram",
  });

  const linkedinCaption = await generateCaption({
    script: scriptResult.script,
    platform: "linkedin",
  });

  console.log(`Provider: ${provider}`);
  console.log(`Model: ${activeModelName(provider)}`);
  console.log(`Word count: ${scriptResult.wordCount}`);
  console.log("\n--- Script ---\n");
  console.log(scriptResult.script);
  console.log("\n--- Instagram Caption ---\n");
  console.log(instagramCaption.caption);
  console.log("\n--- LinkedIn Caption ---\n");
  console.log(linkedinCaption.caption);
}

main().catch((error) => {
  console.error("[llm-smoke] Failed:", error);
  process.exit(1);
});
