/**
 * The plan's cost against the limit the room set, as a drawable bar.
 *
 * WHY A ZERO BUDGET IS THE INTERESTING CASE. `$0` is the first budget chip in
 * the funnel and the product means it: free nights are first-class, and the
 * copy on that screen says picking none is a fine answer. So the denominator is
 * genuinely zero for real rooms, not just in theory. A naive `spent / budget`
 * gives `Infinity` for any paid stop and `NaN` for a free one, and `NaN%` in a
 * width silently collapses the bar to nothing -- a plan that is over budget
 * would draw as empty, which is the opposite of the truth.
 *
 * So zero is handled first and explicitly: a paid plan in a free room is full
 * and over, and an empty plan in a free room is empty and within. This agrees
 * with the server, which already sets `overBudget` the same way.
 *
 * WHY THE TONE IS A ROLE NAME AND NOT A COLOUR. Every colour in this product is
 * a measured pairing against a named ground. Returning `"danger"` lets the
 * component reach for the token that has been measured; returning `#ff9d7a`
 * would hard-code the night value into a module that cannot see the theme.
 */

export type BudgetModel = {
  /** Clamped to 0-100, so it can go straight into a width without a second guard. */
  percent: number;
  over: boolean;
  tone: "accent" | "danger";
};

export function budgetModel(spentCents: number, budgetCents: number): BudgetModel {
  // Negative inputs are not a state this product can reach, but a bar drawn at
  // -40% is a rendering fault rather than a visible error, so they floor at 0.
  const spent = Math.max(0, spentCents);
  const budget = Math.max(0, budgetCents);

  if (budget === 0) {
    const over = spent > 0;
    return { percent: over ? 100 : 0, over, tone: over ? "danger" : "accent" };
  }

  const over = spent > budget;
  return {
    percent: Math.min(100, Math.round((spent / budget) * 100)),
    over,
    tone: over ? "danger" : "accent",
  };
}
