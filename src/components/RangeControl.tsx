interface Props {
  /** Pre-formatted label shown above the slider (already localized). */
  label: string
  min: number
  max: number
  step?: number
  value: number
  onChange: (value: number) => void
}

/** Labelled range slider used across the heatmap-settings panel. Parses the
 *  native string value to a number so callers deal only in numbers. */
export default function RangeControl({ label, min, max, step, value, onChange }: Props) {
  return (
    <label className="opacity-control">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
