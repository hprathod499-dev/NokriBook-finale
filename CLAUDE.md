# Rules for working on Nokri Book

- Tap-to-see numbers / links (drill-downs, breakdown popups, case numbers that open a case):
  keep them in the normal UI style — text colour `inherit`, no theme/accent colour, no underline.
  Use `NbDrillNum` or a plain `<button>` with `color: "inherit"` like the existing ones.
- Never guess or infer any date (disposal dates etc.) — the user enters them himself.
- Push directly to `main`.
