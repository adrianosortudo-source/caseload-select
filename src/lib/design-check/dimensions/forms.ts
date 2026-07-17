import type { DomSnapshot } from "../renderer";
import { type CheckItem, type DimensionResult, scoreItems } from "../dimension-types";

/**
 * Forms and conversion flow (framework weight 9). "The highest-leverage
 * surface for a lead-generating site, and heavily deterministic." Source:
 * framework doc dimension 7, Visual Craft Principles Part 3 §20.
 */

const HIGH_FRICTION_FIELD_COUNT = 6; // "a steep cost past about five fields"

function checkFieldCount(fieldCount: number): CheckItem {
  if (fieldCount === 0) {
    return { label: "Form field count", status: "pass", detail: "No form fields found on this page.", scored: false };
  }
  if (fieldCount < HIGH_FRICTION_FIELD_COUNT) {
    return { label: "Form field count", status: "pass", detail: `${fieldCount} field${fieldCount > 1 ? "s" : ""}, a reasonable ask.` };
  }
  return {
    label: "Form field count",
    status: "warn",
    detail: `${fieldCount} fields. Conversion falls as field count rises, with a steep cost past about 5.`,
    fix: "Cut every field that is not essential to the immediate next action; defer anything else to a follow-up.",
  };
}

function checkLabels(fields: DomSnapshot["forms"][number]["fields"]): CheckItem {
  const placeholderOnly = fields.filter((f) => f.isPlaceholderOnly);
  if (fields.length === 0) {
    return { label: "Field labels", status: "pass", detail: "No fields to check.", scored: false };
  }
  if (placeholderOnly.length === 0) {
    return { label: "Field labels", status: "pass", detail: "Every field has a real label, not placeholder-only." };
  }
  return {
    label: "Field labels",
    status: "fail",
    detail: `${placeholderOnly.length} of ${fields.length} field${fields.length > 1 ? "s" : ""} rely on placeholder text as the only label, which disappears once the field is focused.`,
    fix: "Add a real, persistent <label> for each field. A person who loses the question mid-answer has no way to recall what is being asked.",
  };
}

function checkRequiredExplained(form: DomSnapshot["forms"][number]): CheckItem {
  const anyRequired = form.fields.some((f) => f.isRequired);
  if (!anyRequired) {
    return { label: "Required-field markers explained", status: "pass", detail: "No fields marked required.", scored: false };
  }
  if (form.formTextMentionsRequired) {
    return { label: "Required-field markers explained", status: "pass", detail: "The form's visible text explains what a required marker means." };
  }
  return {
    label: "Required-field markers explained",
    status: "warn",
    detail: "Fields are marked required, but no visible text near the form explains what the marker means.",
    fix: "Spell out what an asterisk or required marker means in visible text; it is routinely misread otherwise.",
  };
}

export function scoreForms(domSnapshot: DomSnapshot): DimensionResult {
  const items: CheckItem[] = [];

  if (domSnapshot.forms.length === 0) {
    items.push({ label: "Contact or intake form", status: "pass", detail: "No form found on this page.", scored: false });
  } else {
    // Score the largest form on the page, since that is almost always the
    // primary intake path; smaller forms (search boxes, newsletter signup)
    // would otherwise dilute the finding.
    const primaryForm = domSnapshot.forms.reduce((a, b) => (b.fieldCount > a.fieldCount ? b : a));
    items.push(checkFieldCount(primaryForm.fieldCount));
    items.push(checkLabels(primaryForm.fields));
    items.push(checkRequiredExplained(primaryForm));
  }

  const { score, maxScore } = scoreItems(items);
  return { name: "Forms and Conversion Flow", weight: 9, score, maxScore, items };
}
