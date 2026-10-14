import { type RuntimeRequestId, type ScopedThreadRef } from "@t3tools/contracts";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { isClaudeResumeCompactionQuestion } from "@t3tools/shared/claudeCompaction";
import { type PendingUserInput } from "../../session-logic";
import {
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import { CheckIcon } from "lucide-react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { cn } from "~/lib/utils";
import { ComposerBanner } from "./ComposerBanner";
import ChatMarkdown from "../ChatMarkdown";

interface PendingUserInputPanelProps {
  pendingUserInputs: PendingUserInput[];
  /** Resolves file links in the question text. */
  cwd: string | undefined;
  threadRef: ScopedThreadRef;
  disabled?: boolean;
  respondingRequestIds: RuntimeRequestId[];
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionValue: string) => void;
  onAdvance: () => void;
  onDismiss: (requestId: RuntimeRequestId) => void;
}

export const ComposerPendingUserInputPanel = memo(function ComposerPendingUserInputPanel({
  pendingUserInputs,
  cwd,
  threadRef,
  disabled = false,
  respondingRequestIds,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
  onDismiss,
}: PendingUserInputPanelProps) {
  if (pendingUserInputs.length === 0) return null;
  const activePrompt = pendingUserInputs[0];
  if (!activePrompt) return null;

  return (
    <ComposerPendingUserInputCard
      key={activePrompt.requestId}
      prompt={activePrompt}
      cwd={cwd}
      threadRef={threadRef}
      disabled={disabled}
      isResponding={respondingRequestIds.includes(activePrompt.requestId)}
      answers={answers}
      questionIndex={questionIndex}
      onToggleOption={onToggleOption}
      onAdvance={onAdvance}
      onDismiss={onDismiss}
    />
  );
});

const ComposerPendingUserInputCard = memo(function ComposerPendingUserInputCard({
  prompt,
  cwd,
  threadRef,
  disabled,
  isResponding,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
  onDismiss,
}: {
  prompt: PendingUserInput;
  cwd: string | undefined;
  threadRef: ScopedThreadRef;
  disabled: boolean;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionValue: string) => void;
  onAdvance: () => void;
  onDismiss: (requestId: RuntimeRequestId) => void;
}) {
  // Message-mode requests remain answerable after their provider turn ends.
  const canRespond = prompt.responseCapability !== "not_resumable";
  const responseDisabled = disabled || isResponding || !canRespond;
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const onAdvanceRef = useRef(onAdvance);
  const [optimisticSingleSelect, setOptimisticSingleSelect] = useState<{
    questionId: string;
    optionValue: string;
  } | null>(null);
  // Collapsing hides everything but the header so a tall prompt stops covering
  // the thread the user is trying to read. Scoped to a single question: the card
  // is keyed by request id so the next prompt starts expanded, and storing the
  // collapsed question's id (rather than a bare flag) reopens the card when the
  // prompt advances to its next question, which can happen without a click —
  // sending from the composer advances the active question.
  const [collapsedQuestionId, setCollapsedQuestionId] = useState<string | null>(null);
  const isCollapsed = collapsedQuestionId !== null && collapsedQuestionId === activeQuestion?.id;

  useEffect(() => {
    onAdvanceRef.current = onAdvance;
  }, [onAdvance]);

  useEffect(() => {
    if (!activeQuestion || activeQuestion.multiSelect || !optimisticSingleSelect) {
      return;
    }
    if (optimisticSingleSelect.questionId !== activeQuestion.id) {
      setOptimisticSingleSelect(null);
      return;
    }
    if (
      progress.customAnswer.trim().length === 0 &&
      progress.selectedOptionValues.includes(optimisticSingleSelect.optionValue)
    ) {
      setOptimisticSingleSelect(null);
    }
  }, [
    activeQuestion,
    optimisticSingleSelect,
    progress.customAnswer,
    progress.selectedOptionValues,
  ]);

  // A delayed answer only advances its own question, while permission remains granted.
  useEffect(() => {
    const clearAutoAdvance = () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
    };
    if (disabled || activeQuestion?.id === undefined) clearAutoAdvance();
    return clearAutoAdvance;
  }, [activeQuestion?.id, disabled]);

  const handleOptionSelection = useCallback(
    (questionId: string, optionValue: string) => {
      if (disabled || isResponding) return;
      if (activeQuestion?.multiSelect) {
        onToggleOption(questionId, optionValue);
        return;
      }
      setOptimisticSingleSelect({ questionId, optionValue });
      onToggleOption(questionId, optionValue);
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
      autoAdvanceTimerRef.current = window.setTimeout(() => {
        autoAdvanceTimerRef.current = null;
        onAdvanceRef.current();
      }, 200);
    },
    [activeQuestion, disabled, isResponding, onToggleOption],
  );

  // Keyboard shortcut: number keys 1-9 select corresponding options when focus is
  // outside editable fields. Multi-select prompts toggle options in place; single-
  // select prompts keep the existing auto-advance behavior. Collapsed prompts opt
  // out, since the numbers they refer to are not on screen.
  useEffect(() => {
    if (!activeQuestion || responseDisabled || isCollapsed) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      if (
        target instanceof HTMLElement &&
        target.closest('[contenteditable]:not([contenteditable="false"])')
      ) {
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
      const optionIndex = digit - 1;
      if (optionIndex >= activeQuestion.options.length) return;
      const option = activeQuestion.options[optionIndex];
      if (!option) return;
      event.preventDefault();
      handleOptionSelection(activeQuestion.id, option.value ?? option.label);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeQuestion, handleOptionSelection, isCollapsed, responseDisabled]);

  if (!activeQuestion) {
    return null;
  }

  const customAnswerActive = progress.customAnswer.trim().length > 0;
  const isResumeCompaction = isClaudeResumeCompactionQuestion(activeQuestion.question);
  const displayQuestion = isResumeCompaction
    ? activeQuestion.question.replace(
        /^This session is (.+) old and uses ([\d,]+) tokens\. Compact it before continuing\?$/u,
        (_, age: string, tokens: string) =>
          `此会话已过去 ${age.replace(/h/g, " 小时").replace(/m/g, " 分钟")}，使用了 ${tokens} Token。继续前要压缩上下文吗？`,
      )
    : activeQuestion.question;

  return (
    <Collapsible
      open={!isCollapsed}
      onOpenChange={(open) => {
        setCollapsedQuestionId(open ? null : activeQuestion.id);
      }}
    >
      <CollapsibleTrigger
        render={<ComposerBanner.Row render={<button type="button" />} />}
        title={isCollapsed ? "显示问题及其选项" : "隐藏问题及其选项"}
        data-pending-user-input-toggle={isCollapsed ? "collapsed" : "expanded"}
      >
        <ComposerBanner.Icon />
        <ComposerBanner.Content>
          <span className="shrink-0 font-medium text-muted-foreground">
            {isResumeCompaction ? "恢复会话" : activeQuestion.header}
          </span>
          {isCollapsed ? (
            <span className="min-w-0 flex-1 truncate text-secondary-label">{displayQuestion}</span>
          ) : null}
        </ComposerBanner.Content>
        <ComposerBanner.Actions>
          {prompt.questions.length > 1 ? (
            <span className="text-3xs font-medium text-muted-foreground tabular-nums">
              {questionIndex + 1}/{prompt.questions.length}
            </span>
          ) : null}
          <ComposerBanner.ToggleIcon expanded={!isCollapsed} />
          {prompt.dismissible ? (
            // Sits inside the trigger button, so stop the click from toggling
            // the disclosure. Dismiss closes the question without a reply.
            <ComposerBanner.Dismiss
              render={<span role="button" tabIndex={0} />}
              aria-label="关闭问题而不作答"
              title="关闭问题而不作答"
              disabled={isResponding}
              data-pending-user-input-dismiss
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDismiss(prompt.requestId);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                onDismiss(prompt.requestId);
              }}
            />
          ) : null}
        </ComposerBanner.Actions>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ComposerBanner.Scroll>
          <ComposerBanner.Body className="pe-1 pb-1 wrap-anywhere">
            <ChatMarkdown
              text={displayQuestion}
              cwd={cwd}
              threadRef={threadRef}
              className="text-foreground/85"
            />
            {activeQuestion.multiSelect ? (
              <p className="mt-1 text-secondary-label text-xs">选择一个或多个选项。</p>
            ) : null}
            <div className="mt-2 space-y-0.5">
              {activeQuestion.options.map((option, index) => {
                const optionValue = option.value ?? option.label;
                const resumeOption = isResumeCompaction
                  ? option.label === "Compact and continue"
                    ? { label: "压缩并继续", description: "使用摘要恢复会话，减少 Token 用量。" }
                    : option.label === "Keep full history"
                      ? { label: "保留完整历史", description: "恢复会话，不更改对话内容。" }
                      : option.label === "Don't ask again"
                        ? { label: "不再询问", description: "保留完整历史，并跳过后续恢复提示。" }
                        : null
                  : null;
                const isOptimisticallySelected =
                  optimisticSingleSelect?.questionId === activeQuestion.id &&
                  optimisticSingleSelect.optionValue === optionValue;
                const isSelected =
                  isOptimisticallySelected ||
                  (!customAnswerActive && progress.selectedOptionValues.includes(optionValue));
                const shortcutKey = index < 9 ? index + 1 : null;
                const className = cn(
                  "group flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/25",
                  isSelected
                    ? "bg-muted/55 text-foreground"
                    : "bg-transparent text-foreground/85 hover:bg-muted/30",
                  (disabled || isResponding) && "opacity-50 cursor-not-allowed",
                  !disabled && !isResponding && "cursor-pointer",
                );
                const content = (
                  <>
                    <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        {resumeOption?.label ?? option.label}
                      </span>
                      {option.description && option.description !== option.label ? (
                        <span className="text-secondary-label text-2xs">
                          {resumeOption?.description ?? option.description}
                        </span>
                      ) : null}
                    </div>
                    {isSelected ? (
                      <CheckIcon className="size-3.5 shrink-0 text-primary" />
                    ) : shortcutKey !== null ? (
                      <kbd
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center text-3xs font-medium text-muted-foreground tabular-nums",
                        )}
                      >
                        {shortcutKey}
                      </kbd>
                    ) : null}
                  </>
                );
                return (
                  <button
                    key={`${activeQuestion.id}:${optionValue}`}
                    type="button"
                    disabled={disabled || isResponding}
                    onClick={() => {
                      handleOptionSelection(activeQuestion.id, optionValue);
                    }}
                    className={className}
                  >
                    {content}
                  </button>
                );
              })}
            </div>
          </ComposerBanner.Body>
        </ComposerBanner.Scroll>
      </CollapsiblePanel>
    </Collapsible>
  );
});
