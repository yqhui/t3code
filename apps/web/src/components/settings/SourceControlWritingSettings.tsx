import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type {
  ProviderInstanceId,
  ServerSettings,
  SourceControlWritingStyleMode,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import {
  resolveReviewGuideModelSelection,
  resolveSourceControlWriterModelSelection,
} from "@t3tools/shared/serverSettings";

import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
  selectsPlanAgent,
} from "../../modelSelection";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Button } from "../ui/button";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { BranchNamingSettings } from "./BranchNamingSettings";
import { searchableSetting } from "./settingsSearch";

const MODE_OPTIONS: Record<SourceControlWritingStyleMode, { label: string; description: string }> =
  {
    repo_conventions: {
      label: "仓库惯例",
      description: "在各项目中沿用最近的变更描述和变更请求标题风格。",
    },
    conventional_commits: {
      label: "Conventional Commits",
      description: "使用 Conventional Commit 前缀，保持变更请求文本简洁。",
    },
    custom: {
      label: "自定义指令",
      description: "在所有项目中按照你的指令生成变更描述和变更请求。",
    },
  };

export function SourceControlWritingSettingsSection() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixedReviewGuidesEnabled = useScopedSettingsMixed(["reviewGuidesEnabled"]);
  const navigate = useNavigate();
  const { environment, connectedEnvironments, targets, target } = useSettingsScope();
  // The representative supplies the provider list; a model choice is checked
  // against every target before it fans out.
  const environmentId = environment?.environmentId ?? null;
  const hasServerTargets = connectedEnvironments.length > 0;
  const serverProviders = environment?.serverConfig?.providers ?? EMPTY_SERVER_PROVIDERS;
  // The writing style is one object; each control only cares about its own field.
  const styleFieldMixed = (field: keyof ServerSettings["sourceControlWritingStyle"]) => {
    const first = targets[0];
    return (
      first !== undefined &&
      targets.some(
        (candidate) =>
          candidate.settings.sourceControlWritingStyle[field] !==
          first.settings.sourceControlWritingStyle[field],
      )
    );
  };
  const modeMixed = styleFieldMixed("mode");
  const instructionsMixed = styleFieldMixed("customInstructions");
  const templatesMixed = styleFieldMixed("followChangeRequestTemplates");
  const writingStyleMixed = modeMixed || instructionsMixed;
  const mixedWriterModel = useScopedSettingsMixed(["sourceControlWriterModelSelection"]);
  const mixedReviewGuideModel = useScopedSettingsMixed(["reviewGuideModelSelection"]);
  const mixedReviewGuideInstructions = useScopedSettingsMixed(["reviewGuideInstructions"]);
  const reviewGuideInstructionsEdited = useRef(false);
  const scopeKey = targets.map((target) => `${target.environmentId}:${target.projectId}`).join(",");
  const customInstructionsRef = useRef<HTMLTextAreaElement>(null);
  const [editingAllInstructions, setEditingAllInstructions] = useState(false);
  const [allInstructions, setAllInstructions] = useState<string | null>(null);
  const style = settings.sourceControlWritingStyle;
  const defaults = DEFAULT_UNIFIED_SETTINGS.sourceControlWritingStyle;
  const isSourceControlWritingStyleDirty =
    writingStyleMixed ||
    style.mode !== defaults.mode ||
    style.customInstructions !== defaults.customInstructions;

  const textGenerationProviders = serverProviders.filter(
    (provider) => provider.supportsTextGeneration !== false,
  );
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(textGenerationProviders),
      settings,
      target?.projectId ?? null,
    ),
  );
  // The environment default can name an instance this project turned off.
  const projectEnabledInstanceIds = new Set(
    instanceEntries
      .filter((entry) => entry.enabled && entry.isAvailable)
      .map((entry) => entry.instanceId),
  );
  const projectEffectiveTextGenerationProviders = textGenerationProviders.filter((provider) =>
    projectEnabledInstanceIds.has(provider.instanceId),
  );
  const defaultModelSelection = resolveAppModelSelectionState(
    settings,
    projectEffectiveTextGenerationProviders,
  );
  const usesDedicatedModel = settings.sourceControlWriterModelSelection !== null;
  const activeSelection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection: resolveSourceControlWriterModelSelection(
        settings,
        projectEffectiveTextGenerationProviders,
        target?.projectId ?? null,
      ),
    },
    projectEffectiveTextGenerationProviders,
  );
  const canEnableDedicatedModel = instanceEntries.some(
    (entry) =>
      entry.instanceId === defaultModelSelection.instanceId && entry.enabled && entry.isAvailable,
  );
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    projectEffectiveTextGenerationProviders,
    activeSelection.instanceId,
    activeSelection.model,
  );
  const writerModelDisabledReason = useScopedModelDisabledReason(settings, instanceEntries);
  const writerInstanceEntry = instanceEntries.find(
    (entry) => entry.instanceId === activeSelection.instanceId,
  );
  const usesReviewGuideModel = settings.reviewGuideModelSelection !== null;
  const reviewGuideSelection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection: resolveReviewGuideModelSelection(
        settings,
        textGenerationProviders,
        target?.projectId ?? null,
      ),
    },
    textGenerationProviders,
  );
  // Its own list: a custom model chosen for guides is not among the writer model's options.
  const reviewGuideModelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    textGenerationProviders,
    reviewGuideSelection.instanceId,
    reviewGuideSelection.model,
  );
  const reviewGuideInstanceEntry = instanceEntries.find(
    (entry) => entry.instanceId === reviewGuideSelection.instanceId,
  );

  return (
    <SettingsSection id="source-control-text-generation" title="文本生成">
      <BranchNamingSettings />
      <SettingsRow
        serverScoped
        settingKeys={["sourceControlWritingStyle"]}
        mixed={writingStyleMixed}
        {...searchableSetting("source-control-writing-style")}
        description={MODE_OPTIONS[style.mode].description}
        resetAction={
          isSourceControlWritingStyleDirty ? (
            <SettingResetButton
              label="版本控制写作风格"
              onClick={() =>
                updateSettings({
                  sourceControlWritingStyle: {
                    mode: defaults.mode,
                    customInstructions: defaults.customInstructions,
                  },
                })
              }
            />
          ) : null
        }
        control={
          <Select
            value={modeMixed ? null : style.mode}
            onValueChange={(value) => {
              const customInstructions = customInstructionsRef.current?.value.trim();
              updateSettings({
                sourceControlWritingStyle: {
                  mode: value as SourceControlWritingStyleMode,
                  ...(customInstructions !== undefined ? { customInstructions } : {}),
                },
              });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="版本控制写作风格">
              <SelectValue>
                {(value: SourceControlWritingStyleMode | null) =>
                  value === null ? "混合" : MODE_OPTIONS[value].label
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {(Object.keys(MODE_OPTIONS) as SourceControlWritingStyleMode[]).map((mode) => (
                <SelectItem key={mode} hideIndicator value={mode}>
                  {MODE_OPTIONS[mode].label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      >
        {writingStyleMixed ? (
          <div className="mt-3 max-w-2xl space-y-2 pb-3.5">
            {editingAllInstructions ? (
              <>
                <Textarea
                  value={allInstructions ?? ""}
                  onChange={(event) => setAllInstructions(event.target.value)}
                  rows={4}
                  aria-label="所有选定环境的自定义版本控制指令"
                  placeholder="输入各选定环境应使用的指令。"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={allInstructions === null}
                  onClick={() => {
                    if (allInstructions === null) return;
                    updateSettings({
                      sourceControlWritingStyle: {
                        mode: "custom",
                        customInstructions: allInstructions.trim(),
                      },
                    });
                    setEditingAllInstructions(false);
                  }}
                >
                  将指令应用到全部
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAllInstructions(null);
                  setEditingAllInstructions(true);
                }}
              >
                为全部目标编写自定义指令
              </Button>
            )}
          </div>
        ) : style.mode === "custom" ? (
          <div className="mt-3 max-w-2xl pb-3.5">
            <Textarea
              key={style.customInstructions}
              ref={customInstructionsRef}
              defaultValue={style.customInstructions}
              onBlur={(event) => {
                const customInstructions = event.target.value.trim();
                if (customInstructions !== style.customInstructions) {
                  updateSettings({ sourceControlWritingStyle: { customInstructions } });
                }
              }}
              rows={4}
              placeholder="保持标题简洁，在描述中使用简短的项目符号列表。"
              aria-label="自定义版本控制写作指令"
            />
          </div>
        ) : null}
      </SettingsRow>

      <SettingsRow
        serverScoped
        settingKeys={["sourceControlWritingStyle"]}
        mixed={templatesMixed}
        {...searchableSetting("follow-change-request-templates")}
        description="仓库提供变更请求描述模板时，使用该模板。"
        resetAction={
          templatesMixed ||
          style.followChangeRequestTemplates !== defaults.followChangeRequestTemplates ? (
            <SettingResetButton
              label="变更请求模板"
              onClick={() =>
                updateSettings({
                  sourceControlWritingStyle: {
                    followChangeRequestTemplates: defaults.followChangeRequestTemplates,
                  },
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            mixed={templatesMixed}
            checked={templatesMixed ? false : style.followChangeRequestTemplates}
            onCheckedChange={(checked) =>
              updateSettings({
                sourceControlWritingStyle: {
                  followChangeRequestTemplates: Boolean(checked),
                },
              })
            }
            aria-label="遵循变更请求模板"
          />
        }
      />

      <SettingsRow
        serverScoped
        settingKeys={["sourceControlWriterModelSelection"]}
        {...searchableSetting("source-control-writer-model")}
        description="生成版本控制文本及分支或书签名称的模型。关闭时使用环境的文本生成模型。"
        control={
          !hasServerTargets ? (
            <span className="text-sm text-muted-foreground">
              请连接环境以选择其版本控制写作模型。
            </span>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {usesDedicatedModel && !canEnableDedicatedModel ? (
                <span className="text-sm text-muted-foreground">暂无可用的文本生成提供商。</span>
              ) : null}
              {usesDedicatedModel && canEnableDedicatedModel ? (
                <ProviderModelPicker
                  environmentId={environmentId}
                  activeInstanceId={activeSelection.instanceId}
                  model={activeSelection.model}
                  lockedProvider={null}
                  instanceEntries={instanceEntries}
                  modelOptionsByInstance={modelOptionsByInstance}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  triggerAriaLabel="版本控制写作模型"
                  {...(mixedWriterModel ? { triggerLabel: "混合" } : {})}
                  {...(environmentId
                    ? {
                        onOpenProviderSetup: (instanceId: ProviderInstanceId) => {
                          void navigate({
                            to: "/settings/providers",
                            search: { environmentId, instanceId },
                          });
                        },
                      }
                    : {})}
                  getModelDisabledReason={writerModelDisabledReason}
                  onInstanceModelChange={(instanceId, model) => {
                    const reason = writerModelDisabledReason(instanceId, model);
                    if (reason) {
                      toastManager.add({
                        type: "error",
                        title: "版本控制写作模型未保存",
                        description: reason,
                      });
                      return;
                    }
                    updateSettings({
                      sourceControlWriterModelSelection: createModelSelection(instanceId, model),
                    });
                  }}
                />
              ) : null}
              {usesDedicatedModel &&
              canEnableDedicatedModel &&
              !mixedWriterModel &&
              writerInstanceEntry ? (
                <TraitsPicker
                  provider={writerInstanceEntry.driverKind}
                  models={writerInstanceEntry.models}
                  model={activeSelection.model}
                  prompt=""
                  onPromptChange={() => {}}
                  modelOptions={activeSelection.options ?? []}
                  allowPromptInjectedEffort={false}
                  planModeEnabled={
                    settings.planModeEnabled || selectsPlanAgent(activeSelection.options)
                  }
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  onModelOptionsChange={(options) =>
                    updateSettings({
                      sourceControlWriterModelSelection: createModelSelection(
                        activeSelection.instanceId,
                        activeSelection.model,
                        options,
                      ),
                    })
                  }
                />
              ) : null}
              <Switch
                checked={usesDedicatedModel}
                disabled={!usesDedicatedModel && !canEnableDedicatedModel}
                onCheckedChange={(checked) =>
                  updateSettings({
                    sourceControlWriterModelSelection: checked
                      ? createModelSelection(
                          defaultModelSelection.instanceId,
                          defaultModelSelection.model,
                          defaultModelSelection.options,
                        )
                      : null,
                  })
                }
                aria-label="使用独立的版本控制写作模型"
              />
            </div>
          )
        }
      />

      {/* A beta the server owns: off hides the Guide tab in every client and refuses agents. */}
      <SettingsRow
        serverScoped
        settingKeys={["reviewGuidesEnabled"]}
        mixed={mixedReviewGuidesEnabled}
        {...searchableSetting("review-guides")}
        description="为拉取请求添加指南标签页：Agent 逐步介绍变更，并指出维护者需要作出的判断。"
        control={
          <Switch
            mixed={mixedReviewGuidesEnabled}
            checked={mixedReviewGuidesEnabled ? false : settings.reviewGuidesEnabled}
            onCheckedChange={(checked) => updateSettings({ reviewGuidesEnabled: Boolean(checked) })}
            aria-label="审查指南"
          />
        }
      />

      {settings.reviewGuidesEnabled || mixedReviewGuidesEnabled ? (
        <>
          <SettingsRow
            serverScoped
            settingKeys={["reviewGuideModelSelection"]}
            {...searchableSetting("review-guide-model")}
            description="阅读拉取请求并编写审查指南的模型。它会分多步阅读变更，因此更强的模型更有帮助。关闭时使用版本控制写作模型。"
            control={
              !hasServerTargets ? (
                <span className="text-sm text-muted-foreground">
                  请连接环境以选择其审查指南模型。
                </span>
              ) : (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {(usesReviewGuideModel || mixedReviewGuideModel) && canEnableDedicatedModel ? (
                    <ProviderModelPicker
                      environmentId={environmentId}
                      activeInstanceId={reviewGuideSelection.instanceId}
                      model={reviewGuideSelection.model}
                      lockedProvider={null}
                      instanceEntries={instanceEntries}
                      modelOptionsByInstance={reviewGuideModelOptionsByInstance}
                      triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                      triggerAriaLabel="审查指南模型"
                      {...(mixedReviewGuideModel ? { triggerLabel: "混合" } : {})}
                      getModelDisabledReason={writerModelDisabledReason}
                      onInstanceModelChange={(instanceId, model) => {
                        const reason = writerModelDisabledReason(instanceId, model);
                        if (reason) {
                          toastManager.add({
                            type: "error",
                            title: "审查指南模型未保存",
                            description: reason,
                          });
                          return;
                        }
                        updateSettings({
                          reviewGuideModelSelection: createModelSelection(instanceId, model),
                        });
                      }}
                    />
                  ) : null}
                  {usesReviewGuideModel &&
                  canEnableDedicatedModel &&
                  !mixedReviewGuideModel &&
                  reviewGuideInstanceEntry ? (
                    <TraitsPicker
                      provider={reviewGuideInstanceEntry.driverKind}
                      models={reviewGuideInstanceEntry.models}
                      model={reviewGuideSelection.model}
                      prompt=""
                      onPromptChange={() => {}}
                      modelOptions={reviewGuideSelection.options ?? []}
                      allowPromptInjectedEffort={false}
                      planModeEnabled={
                        settings.planModeEnabled || selectsPlanAgent(reviewGuideSelection.options)
                      }
                      triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                      onModelOptionsChange={(options) =>
                        updateSettings({
                          reviewGuideModelSelection: createModelSelection(
                            reviewGuideSelection.instanceId,
                            reviewGuideSelection.model,
                            options,
                          ),
                        })
                      }
                    />
                  ) : null}
                  <Switch
                    mixed={mixedReviewGuideModel}
                    checked={mixedReviewGuideModel ? false : usesReviewGuideModel}
                    disabled={!usesReviewGuideModel && !canEnableDedicatedModel}
                    onCheckedChange={(checked) => {
                      if (!checked) {
                        updateSettings({ reviewGuideModelSelection: null });
                        return;
                      }
                      // Every selected target gets this model, so it must run on all of them.
                      const reason = writerModelDisabledReason(
                        activeSelection.instanceId,
                        activeSelection.model,
                      );
                      if (reason) {
                        toastManager.add({
                          type: "error",
                          title: "审查指南模型未保存",
                          description: reason,
                        });
                        return;
                      }
                      updateSettings({
                        reviewGuideModelSelection: createModelSelection(
                          activeSelection.instanceId,
                          activeSelection.model,
                          activeSelection.options,
                        ),
                      });
                    }}
                    aria-label="使用独立的审查指南模型"
                  />
                </div>
              )
            }
          />

          <SettingsRow
            serverScoped
            settingKeys={["reviewGuideInstructions"]}
            {...searchableSetting("review-guide-instructions")}
            description="设置审查指南的偏好：优先展示、重点介绍或跳过哪些内容。指南的格式和覆盖范围保持不变。"
            resetAction={
              mixedReviewGuideInstructions || settings.reviewGuideInstructions !== "" ? (
                <SettingResetButton
                  label="审查指南指令"
                  onClick={() => updateSettings({ reviewGuideInstructions: "" })}
                />
              ) : null
            }
          >
            <div className="mt-3 max-w-2xl pb-3.5">
              <Textarea
                key={`${scopeKey}:${mixedReviewGuideInstructions}:${settings.reviewGuideInstructions}`}
                aria-label="审查指南指令"
                onChange={() => {
                  reviewGuideInstructionsEdited.current = true;
                }}
                rows={4}
                defaultValue={mixedReviewGuideInstructions ? "" : settings.reviewGuideInstructions}
                placeholder={
                  mixedReviewGuideInstructions
                    ? "设置不同。输入指令以应用到所有选定目标。"
                    : "先展示服务接口，再介绍实现。除非测试文件改变了行为，否则跳过。总结不超过两句话。"
                }
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (
                    reviewGuideInstructionsEdited.current &&
                    (mixedReviewGuideInstructions || value !== settings.reviewGuideInstructions)
                  )
                    updateSettings({ reviewGuideInstructions: value });
                  reviewGuideInstructionsEdited.current = false;
                }}
              />
            </div>
          </SettingsRow>
        </>
      ) : null}
    </SettingsSection>
  );
}
