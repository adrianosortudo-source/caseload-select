"use client";

import { useState, type ChangeEvent } from "react";
import { COMMON_COPY } from "@/lib/desired-client/copy";

export interface ChoiceGroupOption {
  id: string;
  label: string;
}

export interface ChoiceGroupProps {
  idPrefix: string;
  name: string;
  legend: string;
  help?: string;
  options: ChoiceGroupOption[];
  type: "radio" | "checkbox";
  value: string | null | string[];
  required?: boolean;
  error?: string;
  maximum?: number;
  exclusiveOptions?: string[];
  exclusiveGroups?: string[][];
  onChange: (value: string | string[]) => void;
  onLimitReached?: () => void;
  hideLegend?: boolean;
}

export function ChoiceGroup({
  idPrefix,
  name,
  legend,
  help,
  options,
  type,
  value,
  required = false,
  error,
  maximum,
  exclusiveOptions = [],
  exclusiveGroups = [],
  onChange,
  onLimitReached,
  hideLegend = false,
}: ChoiceGroupProps) {
  const [limitExceededFor, setLimitExceededFor] = useState<string | null>(null);
  const selectedValues = Array.isArray(value) ? value : value === null ? [] : [value];
  const selectionKey = selectedValues.join("\u001f");
  const localLimitError = maximum !== undefined && limitExceededFor === selectionKey
    ? COMMON_COPY.maxSelection(maximum)
    : undefined;
  const visibleError = error || localLimitError;
  const describedBy = [help ? `${idPrefix}-help` : null, visibleError ? `${idPrefix}-error` : null]
    .filter((id): id is string => id !== null)
    .join(" ") || undefined;
  const exclusiveSet = new Set(exclusiveOptions);
  const selectedRadioValue = typeof value === "string" ? value : null;

  function handleChange(optionId: string, event: ChangeEvent<HTMLInputElement>) {
    if (type === "radio") {
      if (event.currentTarget.checked) {
        setLimitExceededFor(null);
        onChange(optionId);
      }
      return;
    }

    if (!event.currentTarget.checked) {
      setLimitExceededFor(null);
      onChange(selectedValues.filter((selectedId) => selectedId !== optionId));
      return;
    }

    const isExclusive = exclusiveSet.has(optionId);
    const nextValues = isExclusive
      ? [optionId]
      : selectedValues.filter((selectedId) => {
          if (exclusiveSet.has(selectedId)) return false;
          return !exclusiveGroups.some((group) => group.includes(optionId) && group.includes(selectedId));
        });
    if (!isExclusive) nextValues.push(optionId);

    if (maximum !== undefined && nextValues.length > maximum) {
      setLimitExceededFor(selectionKey);
      onLimitReached?.();
      return;
    }

    setLimitExceededFor(null);
    onChange(nextValues);
  }

  return (
    <fieldset
      id={`${idPrefix}-group`}
      className="dc-question"
      data-ui-component-content="choice-group"
      aria-describedby={describedBy}
      aria-required={required || undefined}
      aria-invalid={visibleError ? true : undefined}
    >
      <legend id={`${idPrefix}-legend`} className={hideLegend?"dc-question__legend dc-visually-hidden":"dc-question__legend"} data-ui-copy="heading">
        {legend}
      </legend>
      {help ? (
        <p id={`${idPrefix}-help`} className="dc-question__help" data-ui-copy="supporting">
          {help}
        </p>
      ) : null}
      <div className="dc-option-list">
        {options.map((option) => {
          const inputId = `${idPrefix}-${option.id}`;
          const checked = type === "radio"
            ? selectedRadioValue === option.id
            : selectedValues.includes(option.id);

          return (
            <label key={option.id} htmlFor={inputId} className="dc-option">
              <input
                id={inputId}
                className="dc-option__input"
                type={type}
                name={name}
                value={option.id}
                checked={checked}
                required={type === "radio" && required}
                aria-describedby={describedBy}
                aria-invalid={visibleError ? true : undefined}
                onChange={(event) => handleChange(option.id, event)}
              />
              <span className="dc-option__label" data-ui-copy="body">{option.label}</span>
            </label>
          );
        })}
      </div>
      {visibleError ? (
        <p id={`${idPrefix}-error`} className="dc-option__error" role="alert" data-ui-copy="supporting">
          {visibleError}
        </p>
      ) : null}
    </fieldset>
  );
}