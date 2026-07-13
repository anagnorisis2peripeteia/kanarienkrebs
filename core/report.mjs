// kanarienkrebs (runtime validation) verdict + summary.
// A lane PASSES only with evidence the validation layer was actually live (a planted
// canary was caught) AND that the tests actually ran; ANY new diagnostic fails closed.
export function decideValidationVerdict(report, { allowEmpty = false } = {}) {
  const ev = report.evidence;
  if (ev.layerActive === false) return { verdict: "QUARANTINED", code: 5 };
  if (ev.testsExercised === false) return allowEmpty ? { verdict: "PASS_EMPTY", code: 0 } : { verdict: "NO_EXERCISE", code: 3 };
  if (ev.timedOut) return { verdict: "ERROR", code: 6 };
  if ((report.diagnostics ?? []).length > 0) return { verdict: "FAIL", code: 2 };
  return { verdict: "PASS", code: 0 };
}

export function summarizeValidation(report, decision) {
  const lines = [];
  lines.push(`${report.tool} · lane=${report.lane} · repo=${report.repo}`);
  lines.push(
    `  base=${report.base ?? "(head-only)"} sha=${(report.sha ?? "").slice(0, 8) || "-"} ` +
      `layerActive=${report.evidence.layerActive} testsExercised=${report.evidence.testsExercised} ` +
      `exit=${report.evidence.exitCode ?? "-"}`,
  );
  const diags = report.diagnostics ?? [];
  if (diags.length === 0) lines.push("  (no validation diagnostics on the exercised surface)");
  for (const d of diags) lines.push(`  ✗ ${d.severity} [${d.source}] ${d.message}`);
  lines.push(`  => VERDICT ${decision.verdict} (exit ${decision.code})`);
  return lines.join("\n");
}
