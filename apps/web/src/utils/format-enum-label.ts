// goal: convert enum-like values (IN_REVIEW) into UI labels (In Review).

export function formatEnumLabel(value?: string, fallback = 'N/A') {
  if (!value) return fallback
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
