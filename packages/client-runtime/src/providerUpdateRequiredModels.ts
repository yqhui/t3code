import { PROVIDER_DISPLAY_NAMES, type ServerProvider } from "@t3tools/contracts";
import { compareSemverVersions } from "@t3tools/shared/semver";

// Name the thing the user updates; "Claude" alone reads like the app or model.
const RUNTIME_NAMES: Partial<Record<string, string>> = {
  claudeAgent: "Claude Code",
  codex: "Codex CLI",
};

function formatModelList(names: ReadonlyArray<string>): string {
  return names.join("、");
}

/**
 * Model picker notice for models the manifest announces but the installed
 * provider is too old to run, e.g. "Update Claude Code to v2.1.300 or newer to
 * use Claude Opus 6." With a search query, only gated models it matches are
 * named, so searching for one explains why it is missing. Null when nothing
 * gated matches.
 */
export function formatProviderUpdateRequiredNotice(
  provider: Pick<ServerProvider, "driver" | "updateRequiredModels">,
  searchQuery = "",
): string | null {
  const query = searchQuery.trim().toLocaleLowerCase();
  const models = (provider.updateRequiredModels ?? []).filter(
    (model) =>
      query.length === 0 ||
      model.name.toLocaleLowerCase().includes(query) ||
      model.slug.toLocaleLowerCase().includes(query),
  );
  if (models.length === 0) return null;
  // The highest bar unlocks every listed model.
  const minVersion = models
    .map((model) => model.minVersion)
    .reduce((highest, version) =>
      compareSemverVersions(version, highest) > 0 ? version : highest,
    );
  const providerName =
    RUNTIME_NAMES[provider.driver] ?? PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver;
  const version = minVersion.startsWith("v") ? minVersion : `v${minVersion}`;
  const names = formatModelList(models.map((model) => model.name));
  return `请将 ${providerName} 更新至 ${version} 或更新版本以使用 ${names}。`;
}
