import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  AppError,
  CommitInfo,
  CustomFieldConfig,
  NewIssueDraft,
  WorklogSuggestion,
} from "@shared/domain";
import { ErrorBanner } from "@/components/common/ErrorBanner";
import { Icon } from "@/components/common/Icon";
import { NewIssuePanel } from "@/components/issues/NewIssuePanel";
import { IssueAutocomplete } from "./IssueAutocomplete";

interface SuggestionRowProps {
  suggestion: WorklogSuggestion;
  /** Connection the row belongs to - scopes issue search and Jira links. */
  connectionId: string;
  jiraBaseUrl: string;
  /** Jira project of the row's group; the issue picker is scoped to it. */
  projectKey: string;
  /** Names shown when the row creates a new issue. */
  projectName: string;
  connectionName: string;
  /** Custom fields configured for the row's connection. */
  customFields: CustomFieldConfig[];
  freeText: string;
  commits: CommitInfo[];
  onChange(next: WorklogSuggestion): void;
  onRemove(): void;
}

/** One editable worklog suggestion: issue, date, hours, description. */
export function SuggestionRow({
  suggestion,
  connectionId,
  jiraBaseUrl,
  projectKey,
  projectName,
  connectionName,
  customFields,
  freeText,
  commits,
  onChange,
  onRemove,
}: SuggestionRowProps): JSX.Element {
  const { t } = useTranslation();
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [hint, setHint] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  // Open new-issue form; holds the summary it starts from.
  const [issueForm, setIssueForm] = useState<Partial<NewIssueDraft> | null>(
    null,
  );
  const newIssue = suggestion.newIssue;

  const setNewIssue = (draft: NewIssueDraft | undefined): void =>
    onChange({
      ...suggestion,
      newIssue: draft,
      issueKey: "",
      issueSummary: "",
      issueTypeName: draft?.issueTypeName ?? "",
      issueIsSubtask: false,
    });

  const regenerate = async (): Promise<void> => {
    setRegenerating(true);
    setError(null);
    const result = await window.api.llm.regenerateDescription({
      suggestion,
      hint,
      freeText,
      commits,
    });
    setRegenerating(false);
    if (result.ok) {
      onChange({ ...suggestion, description: result.value });
      setRegenerateOpen(false);
      setHint("");
    } else {
      setError(result.error);
    }
  };

  const setHours = (hours: number): void =>
    onChange({
      ...suggestion,
      hours: Math.min(24, Math.max(0.25, Math.round(hours * 4) / 4)),
    });

  return (
    <div
      className={`suggestion-row ${suggestion.issueKey || newIssue ? "" : "invalid"}`}
    >
      <div className="suggestion-row-main">
        {newIssue ? (
          <div className="suggestion-issue">
            <span className="new-issue-badge">
              <Icon name="plus" size={12} />
              {t("issues.newBadge")}
            </span>
            <input
              className="suggestion-new-summary"
              aria-label={t("issues.summary")}
              value={newIssue.summary}
              onChange={(e) =>
                setNewIssue({ ...newIssue, summary: e.target.value })
              }
            />
          </div>
        ) : (
          <div className="suggestion-issue">
            <IssueAutocomplete
              value={suggestion.issueKey}
              valueTypeName={suggestion.issueTypeName}
              valueIsSubtask={suggestion.issueIsSubtask}
              connectionId={connectionId}
              jiraBaseUrl={jiraBaseUrl}
              projectKeys={projectKey ? [projectKey] : []}
              onChange={(issue) =>
                onChange({
                  ...suggestion,
                  issueKey: issue.key,
                  issueSummary: issue.summary,
                  issueTypeName: issue.typeName,
                  issueIsSubtask: issue.isSubtask,
                  newIssue: undefined,
                })
              }
              onCreate={(summary, withDetails) =>
                withDetails
                  ? setIssueForm({
                      summary,
                      description: suggestion.description,
                    })
                  : setNewIssue({
                      summary,
                      description: suggestion.description,
                      issueTypeId: "",
                      issueTypeName: "",
                    })
              }
            />
            <span className="suggestion-summary">
              {suggestion.issueSummary || t("wizard.pickIssue")}
            </span>
          </div>
        )}
        <input
          className="suggestion-date"
          type="date"
          aria-label={t("wizard.date")}
          value={suggestion.date}
          onChange={(e) => onChange({ ...suggestion, date: e.target.value })}
        />
        <div
          className="hours-stepper"
          role="group"
          aria-label={t("wizard.hours")}
        >
          <button
            type="button"
            aria-label={t("wizard.lessHours")}
            onClick={() => setHours(suggestion.hours - 0.25)}
          >
            −
          </button>
          <input
            type="number"
            min={0.25}
            max={24}
            step={0.25}
            aria-label={t("wizard.hours")}
            value={suggestion.hours}
            onChange={(e) =>
              onChange({ ...suggestion, hours: Number(e.target.value) })
            }
          />
          <button
            type="button"
            aria-label={t("wizard.moreHours")}
            onClick={() => setHours(suggestion.hours + 0.25)}
          >
            +
          </button>
        </div>
        <button
          className="btn btn-ghost btn-icon suggestion-remove"
          onClick={onRemove}
          aria-label={t("wizard.removeEntry")}
          title={t("wizard.removeEntry")}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>

      <textarea
        className="suggestion-desc"
        rows={2}
        aria-label={t("wizard.description")}
        value={suggestion.description}
        onChange={(e) =>
          onChange({ ...suggestion, description: e.target.value })
        }
      />

      {newIssue && (
        <div className="new-issue-note">
          <span>
            {t("issues.willCreate", {
              type: newIssue.issueTypeName || "Task",
              project: projectKey,
            })}
          </span>
          <button className="link" onClick={() => setIssueForm(newIssue)}>
            {t("issues.edit")}
          </button>
          <button className="link" onClick={() => setNewIssue(undefined)}>
            {t("issues.useExisting")}
          </button>
        </div>
      )}

      <div className="suggestion-extras">
        {customFields.map((field) => {
          const value = suggestion.customFields[field.key];
          const setValue = (next: string | boolean): void =>
            onChange({
              ...suggestion,
              customFields: { ...suggestion.customFields, [field.key]: next },
            });
          return field.type === "boolean" ? (
            <label key={field.id} className="switch" title={field.key}>
              <input
                type="checkbox"
                checked={value === true}
                onChange={(e) => setValue(e.target.checked)}
              />
              {field.label}
            </label>
          ) : (
            <label
              key={field.id}
              className="suggestion-text-field"
              title={field.key}
            >
              <span className="muted">{field.label}</span>
              <input
                value={typeof value === "string" ? value : ""}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
          );
        })}
        <span className="spacer" />
        {!regenerateOpen && (
          <button className="link" onClick={() => setRegenerateOpen(true)}>
            {t("wizard.regenerate")}
          </button>
        )}
      </div>

      {error && <ErrorBanner error={error} onRetry={regenerate} />}

      {issueForm && (
        <NewIssuePanel
          mode="draft"
          targets={[{ connectionId, connectionName, projectKey, projectName }]}
          initial={issueForm}
          subtitle={`${suggestion.date} · ${suggestion.hours} h`}
          onSave={setNewIssue}
          onClose={() => setIssueForm(null)}
        />
      )}

      {regenerateOpen && (
        <div className="regenerate-box">
          <input
            autoFocus
            value={hint}
            placeholder={t("wizard.regenerateHintPlaceholder")}
            aria-label={t("wizard.regenerateHint")}
            onChange={(e) => setHint(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && !regenerating && void regenerate()
            }
          />
          <button
            className="btn btn-sm"
            disabled={regenerating}
            onClick={regenerate}
          >
            {regenerating ? (
              <span className="spinner" />
            ) : (
              t("wizard.regenerateRun")
            )}
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setRegenerateOpen(false)}
          >
            {t("app.cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
